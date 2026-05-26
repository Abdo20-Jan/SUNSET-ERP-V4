// Marca proveedores como USD-natos (monedaOperacion = USD) por nombre.
// Útil para Sunset Tires Corporation Limited y Sunset S.A.C.I.S.
// Solo afecta defaults de UI — el saldo USD ya se preserva en LineaAsiento.
//
// Uso:
//   DATABASE_URL=$(grep "^DATABASE_URL=" .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/set-proveedor-usd.ts

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Moneda } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PATRONES_USD = [
  /sunset\s*tires\s*corporation/i,
  /sunset\s*s\.?a\.?c\.?i\.?s/i,
];

async function main() {
  const proveedores = await prisma.proveedor.findMany({
    select: { id: true, nombre: true, monedaOperacion: true },
  });

  for (const p of proveedores) {
    const match = PATRONES_USD.some((re) => re.test(p.nombre));
    if (!match) continue;
    if (p.monedaOperacion === Moneda.USD) {
      console.log(`✓ ${p.nombre} ya está en USD`);
      continue;
    }
    await prisma.proveedor.update({
      where: { id: p.id },
      data: { monedaOperacion: Moneda.USD },
    });
    console.log(`✔ ${p.nombre} marcado como USD`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
