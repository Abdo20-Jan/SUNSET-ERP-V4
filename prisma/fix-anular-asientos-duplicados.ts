/**
 * Fix retroactivo: anula los asientos CONTABILIZADO duplicados que
 * surgieron del race condition en `crearAsientoEmbarqueCosto` (PR #95).
 *
 * Cuando dos requests simultáneos llegaron a contabilizar el mismo
 * EmbarqueCosto, ambos pasaban el check `asientoId === null` y creaban
 * asientos paralelos. El segundo UPDATE sobreescribía `asientoId` en
 * EmbarqueCosto, dejando el primer asiento huérfano (CONTABILIZADO sin
 * FK), pero igualmente sumando al saldo de la cuenta del proveedor.
 *
 * Casos confirmados en producción (diag-saldo-proveedor.ts):
 *   - TERMINAL 7 S.A. 2.1.1.11 / 0010-00034135: 5 asientos × 96.800
 *   - TP LOGISTICA 2.1.1.20 / 0003-00071396: 5 asientos × 1.913.156,13
 *   - CMA-CGM 2.1.1.23 / 0003-00533753: 5 asientos × 316.402,37
 *   - CMA-CGM 2.1.1.23 / 0003-00533754: 5 asientos × 810.518,40
 *   Total "deuda falsa" eliminable: 12.547.507,60 ARS.
 *
 * El fix Fase 1 (atomic updateMany) impide nuevos casos. Este script
 * limpia los históricos. Estrategia:
 *   - Mantener el asiento al que apunta `EmbarqueCosto.asientoId` (FK
 *     estructural — fuente de verdad del schema).
 *   - Anular el resto. Como sus IDs no figuran en ningún FK, los
 *     updateMany sobre Embarque/Venta/Compra/Gasto/EmbarqueCosto
 *     resultan en 0 rows afectados — solo cambia `asiento.estado`.
 *
 * Uso:
 *   pnpm tsx prisma/fix-anular-asientos-duplicados.ts            # dry-run
 *   pnpm tsx prisma/fix-anular-asientos-duplicados.ts --apply    # aplica
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AsientoEstado,
  EmbarqueEstado,
  PeriodoEstado,
  Prisma,
  PrismaClient,
} from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const APPLY = process.argv.includes("--apply");

type TxClient = Prisma.TransactionClient;

/**
 * Anula un asiento. Replica `anularAsiento` de asiento-automatico.ts
 * pero sin importar el módulo (que usa 'server-only', incompatible
 * con tsx). Para asientos huérfanos del race, los updateMany sobre
 * Embarque/Venta/Compra/Gasto/EmbarqueCosto resultarán en 0 rows
 * afectados — solo el asiento.estado cambia a ANULADO.
 */
async function anularAsientoInline(tx: TxClient, asientoId: string): Promise<void> {
  const asiento = await tx.asiento.findUnique({
    where: { id: asientoId },
    include: { periodo: { select: { estado: true } } },
  });
  if (!asiento) {
    throw new Error(`Asiento ${asientoId} no existe.`);
  }
  if (asiento.estado !== AsientoEstado.CONTABILIZADO) {
    throw new Error(
      `Solo asientos CONTABILIZADO pueden anularse (estado actual: ${asiento.estado}).`,
    );
  }
  if (asiento.periodo.estado !== PeriodoEstado.ABIERTO) {
    throw new Error(`No se puede anular un asiento en período ${asiento.periodo.estado}.`);
  }
  // Detach operacional. Para órfãos (no race), todos retornan count=0.
  await tx.embarque.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: EmbarqueEstado.EN_DEPOSITO },
  });
  await tx.movimientoTesoreria.updateMany({ where: { asientoId }, data: { asientoId: null } });
  await tx.prestamoExterno.updateMany({ where: { asientoId }, data: { asientoId: null } });
  await tx.venta.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: "CANCELADA" },
  });
  await tx.compra.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: "CANCELADA" },
  });
  await tx.gasto.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: "ANULADO" },
  });
  await tx.embarqueCosto.updateMany({
    where: { asientoId },
    data: { asientoId: null, estado: "ANULADA" },
  });
  await tx.asiento.update({
    where: { id: asientoId },
    data: { estado: AsientoEstado.ANULADO },
  });
}

async function main() {
  console.log(`\n=== Anulación de asientos EmbarqueCosto duplicados (race condition) ===`);
  console.log(`Modo: ${APPLY ? "APPLY (cambios reales)" : "DRY-RUN (sin cambios)"}\n`);

  // 1. Levantar todos los asientos CONTABILIZADO de origen COMEX que
  //    sigan el patrón "Factura emitida X — Y" (formato de
  //    crearAsientoEmbarqueCosto).
  const asientos = await prisma.asiento.findMany({
    where: {
      estado: AsientoEstado.CONTABILIZADO,
      origen: "COMEX",
      descripcion: { startsWith: "Factura emitida " },
    },
    select: {
      id: true,
      numero: true,
      descripcion: true,
      fecha: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Asientos CONTABILIZADO con descripción "Factura emitida …": ${asientos.length}`);

  // 2. Agrupar por descripción exacta. Cualquier grupo con > 1 row es
  //    una duplicación.
  const grupos = new Map<string, typeof asientos>();
  for (const a of asientos) {
    const prev = grupos.get(a.descripcion ?? "") ?? [];
    prev.push(a);
    grupos.set(a.descripcion ?? "", prev);
  }

  const duplicados = Array.from(grupos.entries()).filter(([_, g]) => g.length > 1);
  console.log(`Grupos duplicados detectados: ${duplicados.length}\n`);

  if (duplicados.length === 0) {
    console.log("Sin duplicaciones. Nada que anular.");
    return;
  }

  let totalAnulados = 0;
  let totalErrores = 0;

  let totalSkipped = 0;

  for (const [descripcion, grupo] of duplicados) {
    const ordenados = [...grupo].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const ids = ordenados.map((a) => a.id);

    // Estrategia: el "mantener" es el asiento al que apunta `EmbarqueCosto.asientoId`
    // (FK estructural actual). Si por algún motivo no hay FK (todos huérfanos),
    // mantener el más antiguo.
    const costosLinkeados = await prisma.embarqueCosto.findMany({
      where: { asientoId: { in: ids } },
      select: {
        id: true,
        asientoId: true,
        facturaNumero: true,
        embarque: { select: { codigo: true } },
      },
    });

    let mantenerId: string;
    if (costosLinkeados.length === 1) {
      mantenerId = costosLinkeados[0]!.asientoId!;
    } else if (costosLinkeados.length === 0) {
      mantenerId = ordenados[0]!.id;
      console.log(`\n--- Duplicación: "${descripcion}"`);
      console.log(`    ⚠ Ningún EmbarqueCosto con FK al grupo — mantengo el más antiguo.`);
    } else {
      console.log(`\n--- Duplicación: "${descripcion}"`);
      console.log(
        `    ✗ SKIP — ${costosLinkeados.length} EmbarqueCostos linkeados al mismo grupo (anomalía):`,
      );
      for (const c of costosLinkeados) {
        console.log(
          `       EmbarqueCosto#${c.id} (factura ${c.facturaNumero}, embarque ${c.embarque.codigo}) → ${c.asientoId?.slice(0, 8)}…`,
        );
      }
      totalSkipped++;
      continue;
    }

    const mantener = ordenados.find((a) => a.id === mantenerId)!;
    const anular = ordenados.filter((a) => a.id !== mantenerId);

    console.log(`\n--- Duplicación: "${descripcion}"`);
    console.log(
      `    MANTENER  → #${mantener.numero} (${mantener.id.slice(0, 8)}…) createdAt=${mantener.createdAt.toISOString()} [FK EmbarqueCosto]`,
    );
    for (const a of anular) {
      console.log(
        `    ANULAR    → #${a.numero} (${a.id.slice(0, 8)}…) createdAt=${a.createdAt.toISOString()}`,
      );
    }

    if (!APPLY) continue;

    for (const a of anular) {
      try {
        await prisma.$transaction((tx) => anularAsientoInline(tx, a.id));
        console.log(`      ✓ Anulado #${a.numero}`);
        totalAnulados++;
      } catch (err) {
        console.error(
          `      ✗ Error al anular #${a.numero}: ${err instanceof Error ? err.message : String(err)}`,
        );
        totalErrores++;
      }
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Grupos procesados: ${duplicados.length}`);
  console.log(`Grupos skipped (anomalía): ${totalSkipped}`);
  if (APPLY) {
    console.log(`Asientos anulados: ${totalAnulados}`);
    console.log(`Errores: ${totalErrores}`);
  } else {
    const aAnular = duplicados.reduce((s, [_, g]) => s + (g.length - 1), 0);
    console.log(`Asientos que se anularían si --apply: ${aAnular}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
