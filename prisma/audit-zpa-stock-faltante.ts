/**
 * Audit read-only: embarques en estado EN_ZONA_PRIMARIA (con
 * `asientoZonaPrimariaId` no nulo) que NO tienen MovimientoStock de
 * tipo INGRESO ligado a sus ItemEmbarque. Estos son embarques que
 * confirmaron ZP antes de la Fase B (sin ingreso físico al depósito
 * ZPA) y representan un desbalance:
 *
 *   - Contabilidad 1.1.5.02 tiene el costo cargado.
 *   - SPD ZPA NO tiene el stock físico.
 *
 * Resultado: la conta 1.1.5.02 no se puede reconciliar con el SPD.
 * Hasta que se despache o se haga un backfill manual, esos embarques
 * son inconsistentes.
 *
 * El script NO modifica nada — solo lista los embarques afectados con
 * datos suficientes para que el operador decida caso a caso:
 *   1. Backfill manual (crear MovimientoStock retroactivo con costo
 *      del rateio ZPA recalculado).
 *   2. Revertir ZP, corregir y re-confirmar (recomendado si el embarque
 *      no tiene despachos contabilizados).
 *   3. Despachar lo restante usando el flujo legacy (sin ZPA).
 *
 * Uso:
 *   pnpm tsx prisma/audit-zpa-stock-faltante.ts
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function fmtMoney(n: number | string): string {
  return Number(n).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function main() {
  const embarques = await prisma.embarque.findMany({
    where: { asientoZonaPrimariaId: { not: null } },
    select: {
      id: true,
      codigo: true,
      estado: true,
      fechaZonaPrimaria: true,
      fobTotal: true,
      tipoCambio: true,
      depositoZonaPrimariaId: true,
      depositoZonaPrimaria: { select: { nombre: true } },
      asientoZonaPrimaria: {
        select: { numero: true, estado: true, totalDebe: true },
      },
      items: {
        select: { id: true, productoId: true, cantidad: true, costoUnitario: true },
      },
      despachos: {
        where: { estado: "CONTABILIZADO" },
        select: { codigo: true, fecha: true },
      },
    },
    orderBy: { fechaZonaPrimaria: "asc" },
  });

  console.log(`Embarques con Zona Primaria confirmada: ${embarques.length}\n`);

  const sinStock: typeof embarques = [];
  for (const emb of embarques) {
    const movsZpa = await prisma.movimientoStock.count({
      where: {
        itemEmbarqueId: { in: emb.items.map((i) => i.id) },
        tipo: "INGRESO",
      },
    });
    if (movsZpa === 0) {
      sinStock.push(emb);
    }
  }

  if (sinStock.length === 0) {
    console.log("✓ Todos los embarques en ZP tienen stock físico en ZPA. Nada que migrar.");
    return;
  }

  console.log(`Embarques afectados (ZP confirmada SIN stock en ZPA): ${sinStock.length}\n`);
  console.log("─".repeat(110));

  for (const emb of sinStock) {
    const fobArs = Number(emb.fobTotal) * Number(emb.tipoCambio);
    const totalDebe = emb.asientoZonaPrimaria?.totalDebe
      ? Number(emb.asientoZonaPrimaria.totalDebe)
      : null;
    const totalCantidad = emb.items.reduce((s, i) => s + i.cantidad, 0);
    const despachosContabilizados = emb.despachos.length;

    console.log(`\n${emb.codigo}  (estado ${emb.estado})`);
    console.log(
      `  fechaZonaPrimaria : ${emb.fechaZonaPrimaria?.toISOString().split("T")[0] ?? "—"}`,
    );
    console.log(
      `  asientoZP         : nº ${emb.asientoZonaPrimaria?.numero ?? "—"}  (${emb.asientoZonaPrimaria?.estado ?? "—"})`,
    );
    console.log(`  depositoZPA       : ${emb.depositoZonaPrimaria?.nombre ?? "(no asignado)"}`);
    console.log(
      `  FOB total         : ${fmtMoney(Number(emb.fobTotal))} ${emb.tipoCambio.toString()}× = ARS ${fmtMoney(fobArs)}`,
    );
    if (totalDebe !== null) {
      console.log(`  saldo 1.1.5.02    : ARS ${fmtMoney(totalDebe)}`);
    }
    console.log(`  items × cantidad  : ${emb.items.length} ítems / ${totalCantidad} unidades`);
    console.log(`  despachos CONT.   : ${despachosContabilizados}`);

    // Sugerencia
    if (despachosContabilizados === 0) {
      console.log(
        `  → SUGERENCIA      : Revertir ZP y re-confirmar (no hay despachos contabilizados).`,
      );
    } else {
      console.log(
        `  → SUGERENCIA      : Backfill manual del stock ZPA — el embarque ya tiene despachos.`,
      );
    }
  }

  console.log("\n" + "─".repeat(110));
  console.log("\nDecisión caso a caso. Este script es READ-ONLY — ningún dato fue modificado.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
