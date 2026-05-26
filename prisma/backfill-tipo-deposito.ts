/**
 * Backfill idempotente: marca depósitos existentes con `tipo` apropiado
 * según convención de nombre. Necesario porque el campo `Deposito.tipo`
 * fue agregado con default NACIONAL, pero depósitos pre-existentes con
 * nombre tipo "ZONA PRIMARIA ADUANEIRA", "ZPA", "TP LOGISTICA - ZPA",
 * etc. quedaron marcados incorrectamente.
 *
 * Reglas:
 *   - Si `upper(nombre) LIKE '%ZONA PRIMARIA%'` → tipo ZONA_PRIMARIA
 *   - Si `upper(nombre) LIKE '%ZPA%'` → tipo ZONA_PRIMARIA
 *   - Si `upper(nombre) LIKE '%ADUAN%'` (aduanero/aduaneiro/aduaneira) → tipo ZONA_PRIMARIA
 *   - Resto queda NACIONAL (default).
 *
 * Uso:
 *   pnpm tsx prisma/backfill-tipo-deposito.ts          # dry-run
 *   pnpm tsx prisma/backfill-tipo-deposito.ts --apply  # aplica cambios
 */
import { config as dotenvConfig } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, TipoDeposito } from "../src/generated/prisma/client";

dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const APPLY = process.argv.includes("--apply");

function inferirTipo(nombre: string): TipoDeposito {
  const upper = nombre.toUpperCase();
  if (
    upper.includes("ZONA PRIMARIA") ||
    upper.includes("ZPA") ||
    upper.includes("ADUAN")
  ) {
    return TipoDeposito.ZONA_PRIMARIA;
  }
  return TipoDeposito.NACIONAL;
}

async function main() {
  const depositos = await prisma.deposito.findMany({
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true, tipo: true, activo: true },
  });

  console.log(`Depósitos encontrados: ${depositos.length}\n`);

  const cambios: Array<{ id: string; nombre: string; antes: TipoDeposito; despues: TipoDeposito }> =
    [];

  for (const d of depositos) {
    const inferido = inferirTipo(d.nombre);
    const flagActivo = d.activo ? "" : " [INACTIVO]";
    if (inferido !== d.tipo) {
      cambios.push({ id: d.id, nombre: d.nombre, antes: d.tipo, despues: inferido });
      console.log(`  ${d.nombre.padEnd(35)}${flagActivo}  ${d.tipo} → ${inferido}`);
    } else {
      console.log(`  ${d.nombre.padEnd(35)}${flagActivo}  ${d.tipo} (sin cambios)`);
    }
  }

  console.log();
  if (cambios.length === 0) {
    console.log("Todos los depósitos ya tienen el tipo correcto. Nada que hacer.");
    return;
  }

  console.log(`Total de cambios: ${cambios.length}`);
  if (!APPLY) {
    console.log("Dry-run. Re-ejecutar con --apply para aplicar.");
    return;
  }

  for (const c of cambios) {
    await prisma.deposito.update({
      where: { id: c.id },
      data: { tipo: c.despues },
    });
  }
  console.log(`✓ ${cambios.length} depósito(s) actualizados.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
