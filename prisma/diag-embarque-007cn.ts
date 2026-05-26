// Verifica el cadastro completo del Embarque AR-251020-007CN para entender
// por qué su FOB no fue capturado por el backfill (probablemente moneda=ARS).
//
// Uso:
//   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"') \
//     pnpm tsx prisma/diag-embarque-007cn.ts

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const e = await prisma.embarque.findFirst({
    where: { codigo: "AR-251020-007CN" },
    include: {
      proveedor: { select: { nombre: true, tipoProveedor: true, pais: true } },
      costos: {
        select: {
          id: true,
          facturaNumero: true,
          moneda: true,
          tipoCambio: true,
          proveedor: { select: { nombre: true } },
        },
      },
    },
  });

  if (!e) {
    console.log("Embarque AR-251020-007CN no encontrado.");
    return;
  }

  console.log(`Embarque ${e.codigo}`);
  console.log(`  Estado:                 ${e.estado}`);
  console.log(`  Proveedor:              ${e.proveedor.nombre}`);
  console.log(`    tipoProveedor:        ${e.proveedor.tipoProveedor}`);
  console.log(`    pais:                 ${e.proveedor.pais}`);
  console.log(`  Moneda (EMBARQUE):      ${e.moneda}     ← determina si entra al backfill`);
  console.log(`  TipoCambio:             ${e.tipoCambio.toString()}`);
  console.log(`  FOB total:              ${e.fobTotal.toString()}`);
  console.log(`  ValorFleteOrigen:       ${e.valorFleteOrigen?.toString() ?? "—"}`);
  console.log(`  ValorSeguroOrigen:      ${e.valorSeguroOrigen?.toString() ?? "—"}`);
  console.log(`  asientoId (cierre):     ${e.asientoId ?? "—"}`);
  console.log(`  asientoZonaPrimariaId:  ${e.asientoZonaPrimariaId ?? "—"}`);

  console.log(`\n  EmbarqueCosto's (${e.costos.length}):`);
  for (const c of e.costos) {
    console.log(
      `    #${c.id} ${c.proveedor.nombre} fact ${c.facturaNumero ?? "?"}  moneda=${c.moneda}  TC=${c.tipoCambio.toString()}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
