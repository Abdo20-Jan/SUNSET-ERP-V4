/**
 * Auditoría standalone de invariantes de stock — sin dependencias de
 * stock.ts (que es server-only).
 *
 * Por cada producto, calcula:
 *  - sumSPD       = SUM(StockPorDeposito.cantidadFisica)
 *  - replayMov    = stock reconstruido replayando MovimientoStock
 *                   (INGRESO: +, EGRESO: -, AJUSTE: +signed, TRANSF: ignored a nivel producto)
 *  - replaySPDDep = stock por depósito reconstruido replayando MovimientoStock
 *                   (INGRESO/EGRESO/AJUSTE/TRANSFERENCIA — todos afectan depósito)
 *
 * Reporta toda divergencia con stockActual o con cantidadFisica del SPD.
 *
 * Salida resumida: tabla con productos problemáticos y diff exacto.
 */

import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type SpdRow = {
  productoId: string;
  depositoId: string;
  cantidadFisica: number;
  cantidadReservada: number;
};

type MovRow = {
  productoId: string;
  depositoId: string;
  tipo: "INGRESO" | "EGRESO" | "AJUSTE" | "TRANSFERENCIA";
  cantidad: number;
};

async function main() {
  const productos = await prisma.producto.findMany({
    where: { activo: true },
    select: { id: true, codigo: true, nombre: true, stockActual: true },
    orderBy: { codigo: "asc" },
  });

  const depositos = await prisma.deposito.findMany({
    select: { id: true, nombre: true },
  });
  const depName = new Map(depositos.map((d) => [d.id, d.nombre]));

  const spds = (await prisma.stockPorDeposito.findMany({
    select: {
      productoId: true,
      depositoId: true,
      cantidadFisica: true,
      cantidadReservada: true,
    },
  })) as SpdRow[];

  const spdByProd = new Map<string, SpdRow[]>();
  for (const s of spds) {
    const arr = spdByProd.get(s.productoId) ?? [];
    arr.push(s);
    spdByProd.set(s.productoId, arr);
  }

  const movimientos = (await prisma.movimientoStock.findMany({
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    select: {
      productoId: true,
      depositoId: true,
      tipo: true,
      cantidad: true,
    },
  })) as MovRow[];

  const movByProd = new Map<string, MovRow[]>();
  for (const m of movimientos) {
    const arr = movByProd.get(m.productoId) ?? [];
    arr.push(m);
    movByProd.set(m.productoId, arr);
  }

  type Violacion = {
    codigo: string;
    productoId: string;
    nombre: string;
    stockActual: number;
    sumSPD: number;
    replayTotal: number;
    detalleDep: string;
  };

  const violaciones: Violacion[] = [];

  for (const p of productos) {
    const spdsDelProd = spdByProd.get(p.id) ?? [];
    const sumSPD = spdsDelProd.reduce((a, s) => a + s.cantidadFisica, 0);

    const movs = movByProd.get(p.id) ?? [];
    let replayTotal = 0;
    const replayPorDep = new Map<string, number>();
    for (const m of movs) {
      const cur = replayPorDep.get(m.depositoId) ?? 0;
      if (m.tipo === "INGRESO") {
        replayTotal += m.cantidad;
        replayPorDep.set(m.depositoId, cur + m.cantidad);
      } else if (m.tipo === "EGRESO") {
        replayTotal -= m.cantidad;
        replayPorDep.set(m.depositoId, cur - m.cantidad);
      } else if (m.tipo === "AJUSTE") {
        replayTotal += m.cantidad;
        replayPorDep.set(m.depositoId, cur + m.cantidad);
      } else if (m.tipo === "TRANSFERENCIA") {
        replayPorDep.set(m.depositoId, cur + m.cantidad);
      }
    }

    const hayProblemaTotal = sumSPD !== p.stockActual || replayTotal !== p.stockActual;
    const detalles: string[] = [];
    const depIds = new Set<string>([
      ...spdsDelProd.map((s) => s.depositoId),
      ...replayPorDep.keys(),
    ]);
    for (const depId of depIds) {
      const fisicaSPD = spdsDelProd.find((s) => s.depositoId === depId)?.cantidadFisica ?? 0;
      const fisicaReplay = replayPorDep.get(depId) ?? 0;
      if (fisicaSPD !== fisicaReplay) {
        detalles.push(
          `${depName.get(depId) ?? depId}: SPD=${fisicaSPD} replay=${fisicaReplay} diff=${fisicaSPD - fisicaReplay}`,
        );
      }
    }

    if (hayProblemaTotal || detalles.length > 0) {
      violaciones.push({
        codigo: p.codigo,
        productoId: p.id,
        nombre: p.nombre,
        stockActual: p.stockActual,
        sumSPD,
        replayTotal,
        detalleDep: detalles.join(" | ") || "—",
      });
    }
  }

  console.log("=".repeat(110));
  console.log(`Productos auditados: ${productos.length}`);
  console.log(`Violaciones encontradas: ${violaciones.length}`);
  console.log("=".repeat(110));

  if (violaciones.length === 0) {
    console.log("OK — todas las invariantes satisfechas.");
    return;
  }

  console.log();
  console.log(
    `${"codigo".padEnd(28)} ${"stockActual".padStart(11)} ${"sumSPD".padStart(8)} ${"replay".padStart(8)} detalle por depósito`,
  );
  console.log("-".repeat(110));
  for (const v of violaciones) {
    console.log(
      `${v.codigo.padEnd(28)} ${v.stockActual.toString().padStart(11)} ${v.sumSPD.toString().padStart(8)} ${v.replayTotal.toString().padStart(8)} ${v.detalleDep}`,
    );
  }
  console.log();

  // Bucket por tipo de problema
  let sumSpdInflada = 0;
  let sumStockInflado = 0;
  let stockActualOk = 0;
  for (const v of violaciones) {
    if (v.sumSPD > v.stockActual) sumSpdInflada++;
    if (v.replayTotal !== v.stockActual) sumStockInflado++;
    if (v.replayTotal === v.stockActual) stockActualOk++;
  }
  console.log("Resumen:");
  console.log(`  Productos con SPD > stockActual:                  ${sumSpdInflada}`);
  console.log(`  Productos con replayMovimientos != stockActual:   ${sumStockInflado}`);
  console.log(`  Productos donde stockActual coincide con replay:  ${stockActualOk}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
