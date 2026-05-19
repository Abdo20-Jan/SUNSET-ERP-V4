/**
 * Diag específico para ECOPLUS C1 — el usuario reporta 500 reales
 * desde 2 embarques: AR-250827-015CN + AR-250915-006CN.
 * Sistema solo tiene 1 MovimientoStock de INGRESO. Verificar:
 *  - existencia/estado de los 2 embarques
 *  - sus ItemEmbarque para ECOPLUS C1
 *  - movimentos relacionados
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
  const codigosEmbarque = ["AR-250827-015CN", "AR-250915-006CN"];

  const producto = await prisma.producto.findFirst({
    where: { codigo: { contains: "ECOPLUS C1", mode: "insensitive" } },
    select: { id: true, codigo: true, nombre: true, stockActual: true },
  });
  if (!producto) {
    console.log("Producto ECOPLUS C1 no encontrado.");
    return;
  }
  console.log("=".repeat(100));
  console.log(`Producto: ${producto.codigo} — ${producto.nombre}`);
  console.log(`  Producto.stockActual = ${producto.stockActual}`);
  console.log();

  // Buscar los 2 embarques por código
  console.log("--- Embarques reportados por el usuario ---");
  for (const codigo of codigosEmbarque) {
    const embarque = await prisma.embarque.findFirst({
      where: { codigo },
      select: {
        id: true,
        codigo: true,
        estado: true,
        fechaSalida: true,
        fechaLlegada: true,
        depositoDestinoId: true,
        depositoDestino: { select: { nombre: true } },
        proveedor: { select: { nombre: true } },
        items: {
          select: {
            id: true,
            productoId: true,
            cantidad: true,
            costoUnitario: true,
            producto: { select: { codigo: true, nombre: true } },
          },
        },
      },
    });
    if (!embarque) {
      console.log(`  ${codigo}: NO EXISTE en la base.`);
      continue;
    }
    console.log(`  ${embarque.codigo}:`);
    console.log(`    estado=${embarque.estado}`);
    console.log(
      `    fechaSalida=${embarque.fechaSalida?.toISOString().slice(0, 10) ?? "—"}  fechaLlegada=${embarque.fechaLlegada?.toISOString().slice(0, 10) ?? "—"}`,
    );
    console.log(`    deposito destino=${embarque.depositoDestino?.nombre ?? "—"}`);
    console.log(`    proveedor=${embarque.proveedor.nombre}`);
    console.log(`    items (${embarque.items.length}):`);
    for (const it of embarque.items) {
      const marca = it.productoId === producto.id ? " <-- ECOPLUS C1" : "";
      console.log(
        `      itemId=${it.id} ${it.producto.codigo.padEnd(28)} cant=${it.cantidad.toString().padStart(6)}  costoUni=${it.costoUnitario}${marca}`,
      );
    }
    console.log();
  }

  // ItemEmbarque del ECOPLUS C1
  console.log("--- Todos los ItemEmbarque del ECOPLUS C1 ---");
  const items = await prisma.itemEmbarque.findMany({
    where: { productoId: producto.id },
    select: {
      id: true,
      cantidad: true,
      costoUnitario: true,
      embarqueId: true,
      embarque: {
        select: {
          codigo: true,
          estado: true,
          fechaSalida: true,
          fechaLlegada: true,
          depositoDestino: { select: { nombre: true } },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  for (const it of items) {
    console.log(
      `  itemId=${it.id}  embarque=${it.embarque.codigo.padEnd(20)} estado=${it.embarque.estado.padEnd(20)} cant=${it.cantidad.toString().padStart(6)}  destino=${it.embarque.depositoDestino?.nombre ?? "—"}`,
    );
  }
  console.log();

  // MovimientoStock del ECOPLUS C1
  console.log("--- Todos los MovimientoStock del ECOPLUS C1 ---");
  const movs = await prisma.movimientoStock.findMany({
    where: { productoId: producto.id },
    orderBy: [{ fecha: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fecha: true,
      tipo: true,
      cantidad: true,
      costoUnitario: true,
      depositoId: true,
      itemEmbarqueId: true,
      itemDespachoId: true,
      transferenciaId: true,
      deposito: { select: { nombre: true } },
    },
  });
  for (const m of movs) {
    const link = m.itemEmbarqueId
      ? `itemEmb=${m.itemEmbarqueId}`
      : m.itemDespachoId
        ? `itemDesp=${m.itemDespachoId}`
        : m.transferenciaId
          ? `transf=${m.transferenciaId}`
          : "—";
    console.log(
      `  mov=${m.id.toString().padStart(6)}  ${m.fecha.toISOString().slice(0, 10)}  ${m.tipo.padEnd(14)} cant=${m.cantidad.toString().padStart(6)}  costoUni=${m.costoUnitario}  dep=${m.deposito.nombre.padEnd(28)} ${link}`,
    );
  }
  console.log();

  // SPD del ECOPLUS C1
  console.log("--- StockPorDeposito del ECOPLUS C1 ---");
  const spds = await prisma.stockPorDeposito.findMany({
    where: { productoId: producto.id },
    select: {
      depositoId: true,
      cantidadFisica: true,
      cantidadReservada: true,
      costoPromedio: true,
      ultimoMovimiento: true,
      deposito: { select: { nombre: true } },
    },
  });
  for (const s of spds) {
    console.log(
      `  ${s.deposito.nombre.padEnd(28)} fisica=${s.cantidadFisica.toString().padStart(6)} reservada=${s.cantidadReservada.toString().padStart(6)}  costoProm=${s.costoPromedio}  ult=${s.ultimoMovimiento?.toISOString().slice(0, 10) ?? "—"}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
