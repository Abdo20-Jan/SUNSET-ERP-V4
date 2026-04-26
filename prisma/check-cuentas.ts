import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const cuentas = await prisma.cuentaContable.findMany({
    where: { codigo: { startsWith: "3.1.1" } },
    select: { codigo: true, nombre: true, tipo: true, activa: true },
    orderBy: { codigo: "asc" },
  });
  console.log("Cuentas 3.1.1.x:");
  cuentas.forEach((c) => console.log(`  ${c.codigo}  ${c.tipo}  ${c.activa ? "✓" : "✗"}  ${c.nombre}`));

  const bancos = await prisma.cuentaBancaria.findMany({
    select: {
      banco: true,
      tipo: true,
      moneda: true,
      cuentaContable: { select: { codigo: true, nombre: true } },
    },
  });
  console.log("\nCuentas bancarias:");
  if (bancos.length === 0) console.log("  (ninguna)");
  bancos.forEach((b) =>
    console.log(`  ${b.banco} · ${b.tipo} · ${b.moneda} → ${b.cuentaContable.codigo} ${b.cuentaContable.nombre}`),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
