/**
 * Fix puntual: recalcula StockPorDeposito.cantidadFisica para
 * CURVE PLUS C1 desde el replay de MovimientoStock.
 *
 * Reimplementa la lógica de `recalcularSPDPorProducto` standalone
 * (sin importar stock.ts que es server-only).
 *
 * NO toca:
 *  - Producto.stockActual (ya está correcto: 250)
 *  - Producto.costoPromedio (ya está correcto)
 *  - SPD.cantidadReservada (preservado intacto)
 *  - MovimientoStock (fuente de verdad, no se modifica)
 *
 * Solo reescribe: SPD.cantidadFisica y SPD.costoPromedio para que
 * coincidan con el replay de MovimientoStock.
 *
 * Transaccional — si algo falla, todo se revierte.
 */

import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

import Decimal from "decimal.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function calcularNuevoPromedio(
  stockAnterior: number,
  promedioAnterior: Decimal,
  cantidadIngreso: number,
  costoIngreso: Decimal,
): Decimal {
  const nuevoStock = stockAnterior + cantidadIngreso;
  if (stockAnterior <= 0 || nuevoStock <= 0) return costoIngreso;
  return promedioAnterior
    .times(stockAnterior)
    .plus(costoIngreso.times(cantidadIngreso))
    .dividedBy(nuevoStock);
}

async function main() {
  const producto = await prisma.producto.findFirst({
    where: { codigo: { contains: "CURVE PLUS C1", mode: "insensitive" } },
    select: { id: true, codigo: true, nombre: true, stockActual: true },
  });
  if (!producto) {
    console.log("Producto no encontrado.");
    return;
  }

  console.log("=".repeat(80));
  console.log(`Producto: ${producto.codigo} — ${producto.nombre}`);
  console.log(`  Producto.stockActual = ${producto.stockActual} (no se modifica)`);
  console.log();

  // ANTES
  const antes = await prisma.stockPorDeposito.findMany({
    where: { productoId: producto.id },
    select: {
      depositoId: true,
      cantidadFisica: true,
      cantidadReservada: true,
      costoPromedio: true,
      deposito: { select: { nombre: true } },
    },
  });
  console.log("ANTES:");
  for (const s of antes) {
    console.log(
      `  ${s.deposito.nombre.padEnd(28)} fisica=${s.cantidadFisica.toString().padStart(6)} reservada=${s.cantidadReservada.toString().padStart(6)} costoProm=${s.costoPromedio}`,
    );
  }
  console.log();

  // Replay de movimientos
  const movs = await prisma.movimientoStock.findMany({
    where: { productoId: producto.id },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    select: { depositoId: true, tipo: true, cantidad: true, costoUnitario: true },
  });

  type Estado = { stock: number; promedio: Decimal };
  const porDeposito = new Map<string, Estado>();
  for (const m of movs) {
    const cur = porDeposito.get(m.depositoId) ?? { stock: 0, promedio: new Decimal(0) };
    if (m.tipo === "INGRESO") {
      cur.promedio = calcularNuevoPromedio(
        cur.stock,
        cur.promedio,
        m.cantidad,
        new Decimal(m.costoUnitario.toString()),
      );
      cur.stock += m.cantidad;
    } else if (m.tipo === "EGRESO") {
      cur.stock -= m.cantidad;
    } else if (m.tipo === "AJUSTE" || m.tipo === "TRANSFERENCIA") {
      cur.stock += m.cantidad;
    }
    porDeposito.set(m.depositoId, cur);
  }

  console.log(`Replay desde ${movs.length} MovimientoStock:`);
  for (const [depId, est] of porDeposito) {
    const dep = antes.find((s) => s.depositoId === depId);
    console.log(
      `  ${(dep?.deposito.nombre ?? depId).padEnd(28)} fisica=${est.stock.toString().padStart(6)} costoProm=${est.promedio.toFixed(2)}`,
    );
  }
  console.log();

  // Pre-validación: SUM(replay) debe coincidir con Producto.stockActual
  const sumReplay = [...porDeposito.values()].reduce((a, e) => a + e.stock, 0);
  if (sumReplay !== producto.stockActual) {
    console.log(
      `ABORT: SUM(replay)=${sumReplay} != Producto.stockActual=${producto.stockActual}. No es seguro tocar el SPD si la fuente de verdad no coincide con el total — investigar antes.`,
    );
    process.exit(1);
  }
  console.log(
    `Pre-check OK: SUM(replay)=${sumReplay} === Producto.stockActual=${producto.stockActual}`,
  );
  console.log();

  // Aplicar en transacción
  await prisma.$transaction(async (tx) => {
    for (const [depositoId, estado] of porDeposito) {
      await tx.stockPorDeposito.upsert({
        where: { productoId_depositoId: { productoId: producto.id, depositoId } },
        create: {
          productoId: producto.id,
          depositoId,
          cantidadFisica: estado.stock,
          cantidadReservada: 0,
          costoPromedio: estado.promedio.toFixed(2),
        },
        update: {
          cantidadFisica: estado.stock,
          costoPromedio: estado.promedio.toFixed(2),
        },
      });
    }
  });

  // DEPOIS
  const despues = await prisma.stockPorDeposito.findMany({
    where: { productoId: producto.id },
    select: {
      depositoId: true,
      cantidadFisica: true,
      cantidadReservada: true,
      costoPromedio: true,
      deposito: { select: { nombre: true } },
    },
  });
  console.log("DESPUÉS:");
  for (const s of despues) {
    console.log(
      `  ${s.deposito.nombre.padEnd(28)} fisica=${s.cantidadFisica.toString().padStart(6)} reservada=${s.cantidadReservada.toString().padStart(6)} costoProm=${s.costoPromedio}`,
    );
  }
  console.log();

  // Validación final
  const sumDespues = despues.reduce((a, s) => a + s.cantidadFisica, 0);
  console.log(
    `Invariante final: SUM(SPD.fisica)=${sumDespues} ${sumDespues === producto.stockActual ? "===" : "!=="} Producto.stockActual=${producto.stockActual}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
