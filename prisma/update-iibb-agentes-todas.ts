// One-shot: marca TODAS las jurisdicciones IIBB como esAgentePercepcion=true.
// Sunset opera bajo Convenio Multilateral, por lo que percibe IIBB en todas
// las provincias. Alícuotas ya están seedeadas con los defaults provinciales.
//
// Run:
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/update-iibb-agentes-todas.ts

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const dbHost = process.env.DATABASE_URL?.match(/@([^/:]+)/)?.[1] ?? "?";
  console.log(`→ DB host: ${dbHost}`);

  const before = await prisma.jurisdiccionIIBB.findMany({
    select: { codigo: true, esAgentePercepcion: true, alicuotaPercepcion: true },
    orderBy: { codigo: "asc" },
  });
  const yaAgentes = before.filter((j) => j.esAgentePercepcion).length;
  console.log(`Antes: ${yaAgentes}/${before.length} jurisdicciones eran agente.`);

  const result = await prisma.jurisdiccionIIBB.updateMany({
    data: { esAgentePercepcion: true },
  });
  console.log(`✓ Update: ${result.count} jurisdicciones marcadas como agente.`);

  const after = await prisma.jurisdiccionIIBB.findMany({
    select: { codigo: true, esAgentePercepcion: true, alicuotaPercepcion: true },
    orderBy: { codigo: "asc" },
  });
  const todasAgentes = after.every((j) => j.esAgentePercepcion);
  console.log(`Después: ${after.length} jurisdicciones, todasAgentes=${todasAgentes}`);
  if (!todasAgentes) {
    console.error("✗ Algunas jurisdicciones no quedaron como agente!");
    process.exit(1);
  }
  console.table(
    after.map((j) => ({
      codigo: j.codigo,
      agente: j.esAgentePercepcion,
      alicuota: j.alicuotaPercepcion.toString(),
    })),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
