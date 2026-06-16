/**
 * Onda E #4 — Backfill de `ItemVenta.costoUnitarioCmv` para las ventas legacy
 * (snapshot 0) con la cuenta-puente 1.1.5.03 MERCADERÍAS A ENTREGAR abierta.
 *
 * Qué hace: por cada venta EMITIDA, nunca entregada (sin entrega CONFIRMADA) y
 * con ítems en `costoUnitarioCmv = 0`, calcula el valor FIEL al runtime —el
 * `Producto.costoPromedio` reproducido a la fecha de emisión replayando los
 * MovimientoStock NACIONAL (lógica compartida `src/lib/services/backfill-cmv.ts`,
 * que reusa el replay del #14)— y lo AUTO-VERIFICA contra `g.haber` (la
 * provisión que la emisión acreditó a 1.1.5.03). Si el replay reproduce la
 * provisión (delta ≤ 1 ct) el backfill cierra el puente exacto al despachar; si
 * no, la venta se MARCA y NO se toca (drift de datos → revisión manual).
 *
 * Idempotente: sólo actualiza ítems con `costoUnitarioCmv = 0`; tras aplicar,
 * la venta deja de calificar. NO contabiliza nada: sólo persiste el snapshot
 * por ítem; el cierre del puente ocurre cuando el dueño despacha la venta por
 * la UI /entregas (la entrega ya lee este snapshot).
 *
 * REQUISITO: la columna `ItemVenta.costoUnitarioCmv` debe existir en prod
 * (PR #219 → `prisma db push --url $PROD_URL`). Sin ella el SELECT falla P2022.
 *
 * Uso (read-only por defecto):
 *   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
 *     pnpm tsx prisma/backfill-costo-unitario-cmv.ts            # dry-run
 *   ... pnpm tsx prisma/backfill-costo-unitario-cmv.ts --apply  # persiste
 */

import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";
import {
  costoPromedioEnFecha,
  type ItemBackfillCmv,
  type MovimientoFechado,
  reconciliarVenta,
} from "../src/lib/services/backfill-cmv";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const APPLY = process.argv.includes("--apply");
const CODIGO_PUENTE = "1.1.5.03";

function toDec(v: unknown): Decimal {
  return new Decimal((v ?? 0).toString());
}
function fmt(n: Decimal): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function fmtFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`\nModo: ${APPLY ? "APPLY (persiste costoUnitarioCmv)" : "DRY-RUN (read-only)"}\n`);

  const cuenta = await prisma.cuentaContable.findFirst({
    where: { codigo: CODIGO_PUENTE },
    select: { id: true, nombre: true },
  });
  if (!cuenta) {
    console.error(`✗ Cuenta ${CODIGO_PUENTE} no encontrada.`);
    return;
  }

  // (1) Atribuir cada línea de 1.1.5.03 a su venta (emisión vía asiento.venta;
  //     entrega vía asiento.entregaVenta) → puente abierto = Σhaber − Σdebe.
  const lineas = await prisma.lineaAsiento.findMany({
    where: { cuentaId: cuenta.id, asiento: { estado: "CONTABILIZADO" } },
    select: {
      debe: true,
      haber: true,
      asiento: {
        select: {
          venta: { select: { id: true } },
          entregaVenta: { select: { ventaId: true } },
        },
      },
    },
  });

  const porVenta = new Map<string, { debe: Decimal; haber: Decimal }>();
  for (const l of lineas) {
    const ventaId = l.asiento.venta?.id ?? l.asiento.entregaVenta?.ventaId ?? null;
    if (!ventaId) continue;
    const g = porVenta.get(ventaId) ?? { debe: new Decimal(0), haber: new Decimal(0) };
    g.debe = g.debe.plus(toDec(l.debe));
    g.haber = g.haber.plus(toDec(l.haber));
    porVenta.set(ventaId, g);
  }
  const abiertas = [...porVenta.entries()]
    .map(([ventaId, g]) => ({
      ventaId,
      abierto: g.haber.minus(g.debe).toDecimalPlaces(2),
      haber: g.haber.toDecimalPlaces(2),
    }))
    .filter((g) => g.abierto.greaterThan(0));

  // (2) Cargar las ventas candidatas: EMITIDA, sin entrega CONFIRMADA, con
  //     ítems legacy (costoUnitarioCmv = 0).
  const ventas = await prisma.venta.findMany({
    where: { id: { in: abiertas.map((a) => a.ventaId) }, estado: "EMITIDA" },
    select: {
      id: true,
      numero: true,
      fecha: true,
      cliente: { select: { nombre: true } },
      entregas: { select: { estado: true } },
      items: {
        select: {
          id: true,
          cantidad: true,
          costoUnitarioCmv: true,
          producto: { select: { codigo: true, costoPromedio: true } },
          productoId: true,
        },
      },
    },
  });
  const haberPorVenta = new Map(abiertas.map((a) => [a.ventaId, a.haber]));

  const candidatas = ventas.filter(
    (v) =>
      !v.entregas.some((e) => e.estado === "CONFIRMADA") &&
      v.items.some((it) => toDec(it.costoUnitarioCmv).isZero()),
  );

  if (candidatas.length === 0) {
    console.log(
      "✓ Sin ventas legacy con puente abierto y costoUnitarioCmv = 0. Nada para backfillear.",
    );
    return;
  }

  // (3) Cargar el historial de MovimientoStock de todos los productos en juego.
  const productoIds = [...new Set(candidatas.flatMap((v) => v.items.map((it) => it.productoId)))];
  const movsPorProducto = new Map<string, MovimientoFechado[]>();
  for (const pid of productoIds) {
    const movs = await prisma.movimientoStock.findMany({
      where: { productoId: pid },
      orderBy: [{ fecha: "asc" }, { id: "asc" }],
      select: {
        tipo: true,
        cantidad: true,
        costoUnitario: true,
        fecha: true,
        deposito: { select: { tipo: true } },
      },
    });
    movsPorProducto.set(
      pid,
      movs.map((m) => ({
        tipo: m.tipo,
        cantidad: m.cantidad,
        costoUnitario: m.costoUnitario,
        fecha: m.fecha,
        depositoTipo: m.deposito.tipo,
      })),
    );
  }

  // (4) Por venta: calcular target por ítem y reconciliar contra g.haber.
  console.log("==================================================================");
  console.log(` CUENTA-PUENTE ${CODIGO_PUENTE} ${cuenta.nombre} — backfill costoUnitarioCmv`);
  console.log("==================================================================\n");

  type Plan = { itemVentaId: number; target: Decimal };
  const planAplicar: Plan[] = [];
  let okCount = 0;
  let flagCount = 0;
  let sumaProvisionOk = new Decimal(0);

  for (const v of candidatas) {
    const itemsLegacy = v.items.filter((it) => toDec(it.costoUnitarioCmv).isZero());
    const backfillItems: (ItemBackfillCmv & { codigo: string })[] = itemsLegacy.map((it) => {
      const movs = movsPorProducto.get(it.productoId) ?? [];
      const emision = costoPromedioEnFecha(movs, v.fecha);
      return {
        itemVentaId: it.id,
        cantidad: it.cantidad,
        costoUnitarioActual: it.producto.costoPromedio,
        costoUnitarioEmision: emision.toFixed(2),
        codigo: it.producto.codigo,
      };
    });

    const provision = haberPorVenta.get(v.id) ?? new Decimal(0);
    const rec = reconciliarVenta(backfillItems, provision);
    const marca = rec.ok ? "✓" : "✗ DRIFT";

    console.log(
      `${marca}  ${v.numero.padEnd(14)} ${fmtFecha(v.fecha)} ${v.cliente.nombre.slice(0, 26).padEnd(26)} ` +
        `provisión=${fmt(rec.provisionEsperada).padStart(16)}  Σ×emisión=${fmt(rec.totalEmision).padStart(16)}  Δ=${fmt(rec.delta).padStart(10)}`,
    );
    for (const bi of backfillItems) {
      console.log(
        `      ${bi.codigo.padEnd(20)} cant=${String(bi.cantidad).padStart(6)}  ` +
          `actual=${fmt(toDec(bi.costoUnitarioActual)).padStart(12)}  emisión→target=${fmt(toDec(bi.costoUnitarioEmision)).padStart(12)}`,
      );
    }

    if (rec.ok) {
      okCount++;
      sumaProvisionOk = sumaProvisionOk.plus(rec.provisionEsperada);
      for (const bi of backfillItems)
        planAplicar.push({ itemVentaId: bi.itemVentaId, target: toDec(bi.costoUnitarioEmision) });
    } else {
      flagCount++;
    }
  }

  // (5) Resumen / reconciliación.
  console.log("\n==================================================================");
  console.log(" RESUMEN");
  console.log("==================================================================");
  console.log(`  ventas candidatas (legacy, puente abierto, sin entrega)  : ${candidatas.length}`);
  console.log(`    · reconcilian con la provisión (backfill seguro) ✓     : ${okCount}`);
  console.log(`    · con DRIFT (NO se backfillean, revisión manual) ✗      : ${flagCount}`);
  console.log(`  ítems a actualizar (de las ventas ✓)                     : ${planAplicar.length}`);
  console.log(
    `  Σ provisión que cerrará 1.1.5.03 al despachar (ventas ✓) : ${fmt(sumaProvisionOk).padStart(18)}`,
  );

  if (!APPLY) {
    console.log(
      "\n  DRY-RUN: nada fue escrito. Revisá los targets y, si están OK, corré con --apply.",
    );
    if (flagCount > 0) {
      console.log(
        `  ⚠ ${flagCount} venta(s) con DRIFT: el replay no reprodujo la provisión de emisión.`,
      );
      console.log(
        "    Indica que se editaron/eliminaron MovimientoStock tras la emisión, o stock dual mixto.",
      );
      console.log("    Esas NO se tocan automáticamente — decidí el valor con el contador.");
    }
    return;
  }

  // (6) APPLY: persistir el snapshot sólo en los ítems de ventas que reconcilian.
  let aplicados = 0;
  for (const p of planAplicar) {
    await prisma.itemVenta.update({
      where: { id: p.itemVentaId },
      data: { costoUnitarioCmv: p.target.toFixed(2) },
    });
    aplicados++;
  }
  console.log(`\n  ✓ APPLY: ${aplicados} ItemVenta.costoUnitarioCmv actualizados.`);
  if (flagCount > 0) {
    console.log(`  ⚠ ${flagCount} venta(s) con DRIFT quedaron SIN tocar (revisión manual).`);
  }
}

main()
  .catch((e) => {
    if (String(e?.message ?? e).match(/costoUnitarioCmv|column .* does not exist|P2022/i)) {
      console.error(
        "\n✗ La columna ItemVenta.costoUnitarioCmv no existe en la base.\n" +
          "  Aplicá primero el schema del PR #219:  prisma db push --url $PROD_URL\n",
      );
    } else {
      console.error(e);
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
