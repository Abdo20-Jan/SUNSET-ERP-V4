import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Renomeia as contas analíticas do range 1.1.5 (Estoque / Bienes de Cambio)
 * para o padrão "Estoque + depósito + estado". O seed e o registry já criam
 * contas novas com esses nomes; este script existe para atualizar as contas
 * já existentes em prod (getOrCreateCuenta não atualiza nome quando o código
 * já existe).
 *
 * Idempotente: roda múltiplas vezes sem efeito colateral.
 *
 * Uso:
 *   pnpm tsx prisma/rename-cuentas-1-1-5.ts --dry-run
 *   pnpm tsx prisma/rename-cuentas-1-1-5.ts
 */

const DRY_RUN = process.argv.includes("--dry-run");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const RENAMES: { codigo: string; nombre: string }[] = [
  { codigo: "1.1.5", nombre: "ESTOQUE" },
  { codigo: "1.1.5.01", nombre: "Estoque TP - Nacionalizado" },
  { codigo: "1.1.5.02", nombre: "Estoque En Tránsito - Marítimo" },
  { codigo: "1.1.5.03", nombre: "Estoque a Entregar" },
  { codigo: "1.1.5.04", nombre: "Estoque TP Logistica - Zona Primária" },
  { codigo: "1.1.5.05", nombre: "Estoque TP Logistica - Depósito Fiscal" },
];

async function main() {
  console.log(`\n=== RENAME CUENTAS 1.1.5 ${DRY_RUN ? "(DRY-RUN)" : "(APLICANDO)"} ===`);

  let actualizados = 0;
  let yaCorrectos = 0;
  let inexistentes = 0;

  for (const r of RENAMES) {
    const before = await db.cuentaContable.findUnique({
      where: { codigo: r.codigo },
      select: { id: true, nombre: true },
    });
    if (!before) {
      console.log(`  ⚠  ${r.codigo} — não existe na base, pulando`);
      inexistentes++;
      continue;
    }
    if (before.nombre === r.nombre) {
      console.log(`  ✓  ${r.codigo} — já está com nome correto ("${r.nombre}")`);
      yaCorrectos++;
      continue;
    }
    if (!DRY_RUN) {
      await db.cuentaContable.update({
        where: { codigo: r.codigo },
        data: { nombre: r.nombre },
      });
    }
    console.log(`  →  ${r.codigo}: "${before.nombre}" → "${r.nombre}"`);
    actualizados++;
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`  Atualizados:  ${actualizados} ${DRY_RUN ? "(estimado)" : ""}`);
  console.log(`  Já corretos:  ${yaCorrectos}`);
  console.log(`  Inexistentes: ${inexistentes}`);
  if (DRY_RUN) console.log("\n(DRY-RUN: nada foi escrito na base.)");
}

main()
  .then(() => db.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error("ERROR:", e);
    await db.$disconnect();
    process.exit(1);
  });
