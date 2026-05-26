/**
 * Diagnóstico do histórico de stock dos 2 produtos afetados:
 *   - 295 ROBUSTO A2 (esperado: só vem do AR-251223-036CN)
 *   - 295 ECOPLUS C1 (esperado: NACIONAL vem de OUTROS embarques anteriores,
 *     porque AR-251020-007CN ainda está EN_ZONA_PRIMARIA)
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PRODUCTOS = ["295 ROBUSTO A2", "295 ECOPLUS C1"];

async function main() {
  for (const codigo of PRODUCTOS) {
    console.log(`\n${"=".repeat(78)}`);
    console.log(`PRODUCTO: ${codigo}`);
    console.log(`${"=".repeat(78)}`);

    const producto = await prisma.producto.findFirst({
      where: { codigo },
      select: { id: true, codigo: true, nombre: true },
    });
    if (!producto) {
      console.log(`No encontrado.`);
      continue;
    }

    // 1. ItemEmbarques deste produto (todos)
    const items = await prisma.itemEmbarque.findMany({
      where: { productoId: producto.id },
      select: {
        id: true,
        cantidad: true,
        precioUnitarioFob: true,
        costoUnitario: true,
        embarque: { select: { codigo: true, estado: true } },
      },
    });
    console.log(`\n— ItemEmbarques (${items.length})`);
    for (const it of items) {
      console.log(
        `  Item#${it.id} embarque=${it.embarque.codigo} estado=${it.embarque.estado} qty=${it.cantidad} fob=${it.precioUnitarioFob} costoU=${it.costoUnitario}`,
      );
    }

    // 2. StockPorDeposito atual
    const stocks = await prisma.stockPorDeposito.findMany({
      where: { productoId: producto.id },
      include: { deposito: { select: { nombre: true, tipo: true } } },
    });
    console.log(`\n— StockPorDeposito atual`);
    for (const s of stocks) {
      console.log(
        `  ${s.deposito.tipo.padEnd(14)} ${s.deposito.nombre.padEnd(32)} qty=${s.cantidadFisica} reservada=${s.cantidadReservada} costoProm=${s.costoPromedio} ultimoMov=${s.ultimoMovimiento.toISOString().slice(0, 10)}`,
      );
    }

    // 3. MovimientoStock histórico
    const movs = await prisma.movimientoStock.findMany({
      where: { productoId: producto.id },
      select: {
        id: true,
        tipo: true,
        cantidad: true,
        costoUnitario: true,
        fecha: true,
        deposito: { select: { nombre: true } },
        itemEmbarque: { select: { embarque: { select: { codigo: true } } } },
        itemDespacho: { select: { despacho: { select: { codigo: true } } } },
      },
      orderBy: { fecha: "asc" },
    });
    console.log(`\n— MovimientoStock histórico (${movs.length})`);
    for (const m of movs) {
      const origen = m.itemEmbarque
        ? `embarque ${m.itemEmbarque.embarque.codigo}`
        : m.itemDespacho
          ? `despacho ${m.itemDespacho.despacho.codigo}`
          : "(sem origem)";
      console.log(
        `  #${m.id} ${m.fecha.toISOString().slice(0, 10)} ${m.tipo.padEnd(20)} qty=${m.cantidad.toString().padStart(5)} costoU=${m.costoUnitario.toString().padStart(10)} ${m.deposito.nombre} ← ${origen}`,
      );
    }

    // 4. Reservas (EntregaVenta y Venta) sobre este producto
    const ventasItems = await prisma.itemVenta.findMany({
      where: { productoId: producto.id, venta: { estado: { in: ["EMITIDA"] } } },
      select: {
        id: true,
        cantidad: true,
        venta: {
          select: {
            numero: true,
            estado: true,
            fecha: true,
            cliente: { select: { nombre: true } },
          },
        },
      },
    });
    console.log(
      `\n— Vendas EMITIDAS com este producto (potenciais reservas) ${ventasItems.length}`,
    );
    for (const v of ventasItems) {
      console.log(
        `  Venta ${v.venta.numero} ${v.venta.estado} cliente=${v.venta.cliente.nombre} fecha=${v.venta.fecha.toISOString().slice(0, 10)} qty=${v.cantidad}`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
