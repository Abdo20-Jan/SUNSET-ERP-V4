import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const CUENTAS = [
  {
    codigo: "1.1.6.02",
    nombre: "INVERSIONES — SANTANDER SUPERFONDOS PESOS",
  },
  {
    codigo: "1.1.6.03",
    nombre: "INVERSIONES — GALICIA FONDOS FIMA PESOS",
  },
] as const;

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const padre = await db.cuentaContable.findUnique({
    where: { codigo: "1.1.6" },
    select: { id: true, nombre: true, categoria: true, activa: true },
  });
  if (!padre) {
    throw new Error(
      "SINTETICA 1.1.6 INVERSIONES no existe. Corré `pnpm tsx prisma/seed.ts` antes.",
    );
  }
  if (!padre.activa) {
    throw new Error("1.1.6 está inactiva — abortando.");
  }

  for (const c of CUENTAS) {
    const data = {
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: "ANALITICA" as const,
      categoria: padre.categoria,
      nivel: c.codigo.split(".").length,
      padreCodigo: "1.1.6",
      activa: true,
    };
    const result = await db.cuentaContable.upsert({
      where: { codigo: c.codigo },
      update: { nombre: c.nombre, padreCodigo: "1.1.6", activa: true },
      create: data,
    });
    console.log(`✓ ${result.codigo}  ${result.nombre}`);
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
