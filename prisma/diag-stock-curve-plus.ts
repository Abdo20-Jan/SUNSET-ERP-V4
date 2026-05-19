/**
 * Diagnóstico para CURVE PLUS C1 — investigar discrepancia entre
 *   Producto.stockActual y SUM(StockPorDeposito.cantidadFisica)
 *   y entre stock físico y movimentos de ingreso/embarques.
 */

import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const codigoBuscado = process.argv[2] ?? "CURVE PLUS C1";

  const producto = await prisma.producto.findFirst({
    where: {
      OR: [
        { codigo: { contains: codigoBuscado, mode: "insensitive" } },
        { nombre: { contains: codigoBuscado, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      codigo: true,
      nombre: true,
      stockActual: true,
      costoPromedio: true,
    },
  });

  if (!producto) {
    console.log(`No se encontró producto que coincida con "${codigoBuscado}".`);
    return;
  }

  console.log("=".repeat(80));
  console.log(`Producto: ${producto.codigo} — ${producto.nombre}`);
  console.log(`  Producto.stockActual    = ${producto.stockActual}`);
  console.log(`  Producto.costoPromedio  = ${producto.costoPromedio}`);
  console.log();

  // SPD por depósito
  const spds = await prisma.stockPorDeposito.findMany({
    where: { productoId: producto.id },
    select: {
      depositoId: true,
      cantidadFisica: true,
      cantidadReservada: true,
      costoPromedio: true,
      deposito: { select: { nombre: true } },
    },
  });

  console.log("StockPorDeposito (SPD):");
  let sumFisica = 0;
  let sumReservada = 0;
  for (const s of spds) {
    sumFisica += s.cantidadFisica;
    sumReservada += s.cantidadReservada;
    console.log(
      `  ${s.deposito.nombre.padEnd(28)} fisica=${s.cantidadFisica.toString().padStart(6)}  reservada=${s.cantidadReservada.toString().padStart(6)}  costoProm=${s.costoPromedio}`,
    );
  }
  console.log(
    `  ${"TOTAL".padEnd(28)} fisica=${sumFisica.toString().padStart(6)}  reservada=${sumReservada.toString().padStart(6)}`,
  );
  console.log();

  console.log("Invariante 1 (SUM(SPD.fisica) == Producto.stockActual):");
  if (sumFisica === producto.stockActual) {
    console.log(`  OK (${sumFisica} === ${producto.stockActual})`);
  } else {
    console.log(
      `  VIOLADA: SUM(SPD.fisica)=${sumFisica} != Producto.stockActual=${producto.stockActual}  (diff=${sumFisica - producto.stockActual})`,
    );
  }
  console.log();

  // Movimientos de stock
  const movimientos = await prisma.movimientoStock.findMany({
    where: { productoId: producto.id },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    select: {
      id: true,
      depositoId: true,
      tipo: true,
      cantidad: true,
      costoUnitario: true,
      fecha: true,
      itemEmbarqueId: true,
      itemDespachoId: true,
      transferenciaId: true,
      deposito: { select: { nombre: true } },
    },
  });

  console.log(`MovimientoStock (${movimientos.length}):`);
  console.log(
    `  ${"fecha".padEnd(11)} ${"deposito".padEnd(28)} ${"tipo".padEnd(14)} ${"cant".padStart(7)}  ${"costoUni".padStart(12)}  link`,
  );
  let stockReplay = 0;
  const fisicaReplay = new Map<string, number>();
  for (const m of movimientos) {
    const fecha = m.fecha.toISOString().slice(0, 10);
    const link = m.itemEmbarqueId
      ? `embarque-item=${m.itemEmbarqueId}`
      : m.itemDespachoId
        ? `despacho-item=${m.itemDespachoId}`
        : m.transferenciaId
          ? `transf=${m.transferenciaId}`
          : "—";
    console.log(
      `  ${fecha}  ${m.deposito.nombre.padEnd(28)} ${m.tipo.padEnd(14)} ${m.cantidad.toString().padStart(7)}  ${m.costoUnitario.toString().padStart(12)}  ${link}`,
    );

    if (m.tipo === "INGRESO") {
      stockReplay += m.cantidad;
      fisicaReplay.set(m.depositoId, (fisicaReplay.get(m.depositoId) ?? 0) + m.cantidad);
    } else if (m.tipo === "EGRESO") {
      stockReplay -= m.cantidad;
      fisicaReplay.set(m.depositoId, (fisicaReplay.get(m.depositoId) ?? 0) - m.cantidad);
    } else if (m.tipo === "AJUSTE") {
      stockReplay += m.cantidad;
      fisicaReplay.set(m.depositoId, (fisicaReplay.get(m.depositoId) ?? 0) + m.cantidad);
    } else if (m.tipo === "TRANSFERENCIA") {
      fisicaReplay.set(m.depositoId, (fisicaReplay.get(m.depositoId) ?? 0) + m.cantidad);
    }
  }
  console.log();

  console.log("Replay desde MovimientoStock:");
  console.log(`  stock total replay         = ${stockReplay}`);
  for (const [depId, qty] of fisicaReplay) {
    const dep = spds.find((s) => s.depositoId === depId);
    console.log(`  fisica replay [${dep?.deposito.nombre ?? depId}] = ${qty}`);
  }
  console.log();

  // ItemEmbarque vinculados
  const items = await prisma.itemEmbarque.findMany({
    where: { productoId: producto.id },
    select: {
      id: true,
      cantidad: true,
      costoUnitario: true,
      embarque: {
        select: {
          id: true,
          codigo: true,
          estado: true,
          fechaSalida: true,
          fechaLlegada: true,
          fechaContabilizacion: true,
          depositoDestinoId: true,
          depositoDestino: { select: { nombre: true } },
          proveedor: { select: { nombre: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });

  console.log(`ItemEmbarque (${items.length}):`);
  console.log(
    `  ${"itemId".padStart(8)}  ${"cant".padStart(6)}  ${"embarque".padEnd(20)} ${"estado".padEnd(20)} ${"deposito".padEnd(20)} ${"fContab".padEnd(11)} proveedor`,
  );
  for (const it of items) {
    const fc = it.embarque.fechaContabilizacion?.toISOString().slice(0, 10) ?? "—";
    console.log(
      `  ${it.id.toString().padStart(8)}  ${it.cantidad.toString().padStart(6)}  ${it.embarque.codigo.padEnd(20)} ${it.embarque.estado.padEnd(20)} ${(it.embarque.depositoDestino?.nombre ?? "—").padEnd(20)} ${fc.padEnd(11)} ${it.embarque.proveedor.nombre}`,
    );
  }
  console.log();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
