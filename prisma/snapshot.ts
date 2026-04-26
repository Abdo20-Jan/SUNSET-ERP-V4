import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const counts = await Promise.all([
    db.user.count(),
    db.cuentaContable.count(),
    db.periodoContable.count(),
    db.cliente.count(),
    db.proveedor.count(),
    db.producto.count(),
    db.deposito.count(),
    db.cuentaBancaria.count(),
    db.movimientoTesoreria.count(),
    db.prestamoExterno.count(),
    db.embarque.count(),
    db.itemEmbarque.count(),
    db.embarqueCosto.count(),
    db.embarqueCostoLinea.count(),
    db.compra.count(),
    db.itemCompra.count(),
    db.venta.count(),
    db.asiento.count(),
    db.lineaAsiento.count(),
  ]);

  const labels = [
    "user",
    "cuentaContable",
    "periodoContable",
    "cliente",
    "proveedor",
    "producto",
    "deposito",
    "cuentaBancaria",
    "movimientoTesoreria",
    "prestamoExterno",
    "embarque",
    "itemEmbarque",
    "embarqueCosto",
    "embarqueCostoLinea",
    "compra",
    "itemCompra",
    "venta",
    "asiento",
    "lineaAsiento",
  ];

  const grouped = await db.asiento.groupBy({
    by: ["estado"],
    _count: { _all: true },
  });

  console.log("=== Counts ===");
  labels.forEach((l, i) => console.log(`  ${l.padEnd(22)} ${counts[i]}`));
  console.log("=== Asientos por estado ===");
  grouped.forEach((g) =>
    console.log(`  ${g.estado.padEnd(15)} ${g._count._all}`),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
