/**
 * W3.3 — Validador de invariantes stock dual.
 *
 * Verifica que los datos de stock estén consistentes después del
 * backfill (W3.3) y de cualquier movimento posterior:
 *
 *   Invariante 1: SUM(StockPorDeposito.cantidadFisica) por producto
 *                 == Producto.stockActual
 *
 *   Invariante 2: Para cada StockPorDeposito,
 *                 cantidadReservada >= 0 y cantidadFisica >= cantidadReservada
 *                 (no se puede reservar más de lo que hay físicamente).
 *
 *   Invariante 3: Para cada StockPorDeposito,
 *                 cantidadFisica >= 0
 *
 * Diseñado para correr en cron (CI diario) o manualmente. Exit code:
 *  - 0: todas las invariantes satisfechas.
 *  - 1: una o más violaciones encontradas.
 *
 * Uso:
 *   pnpm db:validar-stock
 *   pnpm db:validar-stock --recalcular-reservas   (S3.3: reconstruye
 *     SPD.cantidadReservada desde ventas EMITIDA pendientes antes de
 *     validar — útil después de un replay de movimientos.)
 */

import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { recalcularReservasPorProducto } from "../src/lib/services/stock";

type Violacion = {
  invariante: string;
  productoCodigo: string;
  productoId: string;
  depositoId?: string;
  detalle: string;
};

async function validar(prisma: PrismaClient): Promise<Violacion[]> {
  const violaciones: Violacion[] = [];

  // Invariante 1: SUM(SPD.fisica) por producto == Producto.stockActual
  const productos = await prisma.producto.findMany({
    select: { id: true, codigo: true, stockActual: true },
    orderBy: { codigo: "asc" },
  });
  for (const p of productos) {
    const agg = await prisma.stockPorDeposito.aggregate({
      where: { productoId: p.id },
      _sum: { cantidadFisica: true },
    });
    const sum = agg._sum.cantidadFisica ?? 0;
    if (sum !== p.stockActual) {
      violaciones.push({
        invariante: "1: SUM(SPD.fisica) == Producto.stockActual",
        productoCodigo: p.codigo,
        productoId: p.id,
        detalle: `esperado=${p.stockActual} actual=${sum}`,
      });
    }
  }

  // Invariantes 2 y 3: por (producto, depósito)
  const todos = await prisma.stockPorDeposito.findMany({
    select: {
      productoId: true,
      depositoId: true,
      cantidadFisica: true,
      cantidadReservada: true,
      producto: { select: { codigo: true } },
    },
  });
  for (const spd of todos) {
    if (spd.cantidadFisica < 0) {
      violaciones.push({
        invariante: "3: cantidadFisica >= 0",
        productoCodigo: spd.producto.codigo,
        productoId: spd.productoId,
        depositoId: spd.depositoId,
        detalle: `cantidadFisica=${spd.cantidadFisica}`,
      });
    }
    if (spd.cantidadReservada < 0) {
      violaciones.push({
        invariante: "2a: cantidadReservada >= 0",
        productoCodigo: spd.producto.codigo,
        productoId: spd.productoId,
        depositoId: spd.depositoId,
        detalle: `cantidadReservada=${spd.cantidadReservada}`,
      });
    }
    if (spd.cantidadFisica < spd.cantidadReservada) {
      violaciones.push({
        invariante: "2b: cantidadFisica >= cantidadReservada",
        productoCodigo: spd.producto.codigo,
        productoId: spd.productoId,
        depositoId: spd.depositoId,
        detalle: `fisica=${spd.cantidadFisica} reservada=${spd.cantidadReservada}`,
      });
    }
  }

  return violaciones;
}

async function recalcularReservas(prisma: PrismaClient): Promise<void> {
  const productos = await prisma.producto.findMany({
    select: { id: true, codigo: true },
    orderBy: { codigo: "asc" },
  });
  console.log(
    `→ Recalculando reservas para ${productos.length} producto(s)...`,
  );
  let n = 0;
  for (const p of productos) {
    await prisma.$transaction(async (tx) => {
      await recalcularReservasPorProducto(tx, p.id);
    });
    n++;
  }
  console.log(`✓ Reservas recalculadas (${n} productos procesados).`);
}

async function main(): Promise<void> {
  const recalcular = process.argv.includes("--recalcular-reservas");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    if (recalcular) {
      await recalcularReservas(prisma);
    }
    const violaciones = await validar(prisma);
    if (violaciones.length === 0) {
      console.log("✓ Todas las invariantes de stock dual están satisfechas.");
      process.exit(0);
    }
    console.error(`✗ ${violaciones.length} violación(es) encontrada(s):\n`);
    for (const v of violaciones) {
      const dep = v.depositoId ? ` deposito=${v.depositoId}` : "";
      console.error(
        `  [${v.invariante}] producto=${v.productoCodigo} (${v.productoId})${dep} → ${v.detalle}`,
      );
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error("✗ Error fatal:", err instanceof Error ? err.message : err);
  process.exit(2);
});
