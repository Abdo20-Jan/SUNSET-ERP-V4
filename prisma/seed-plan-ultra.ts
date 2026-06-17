/**
 * Seed del plan de cuentas RT9 desde `PLAN_RT9` (fuente única estructurada en
 * `src/lib/services/plan-de-cuentas.ts`). Rebuild #3.
 *
 * - Idempotente: upsert por `codigo`.
 * - Siembra PADRES antes que HIJOS (orden por `nivel`, luego `codigo`) para
 *   satisfacer la FK self-relation `padreCodigo → codigo`.
 * - Autovalida el plan (`validarPlan`) antes de tocar la DB; aborta si hay
 *   inconsistencias (huérfanas, categoría incoherente, regularizadora sin
 *   naturaleza, etc.).
 * - DRY-RUN por defecto; sólo `--apply` escribe.
 *
 * Uso:
 *   pnpm tsx prisma/seed-plan-rt9.ts            # dry-run (no escribe)
 *   pnpm tsx prisma/seed-plan-rt9.ts --apply    # siembra/actualiza
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PLAN_RT9, planEntryToSeedRecord, validarPlan } from "@/lib/services/plan-de-cuentas";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const problemas = validarPlan(PLAN_RT9);
  if (problemas.length > 0) {
    console.error(`❌ PLAN_RT9 inconsistente (${problemas.length}) — abortando:`);
    for (const p of problemas) console.error(`  [${p.regla}] ${p.codigo}: ${p.detalle}`);
    process.exit(1);
  }

  // Padres antes que hijos: el orden por nivel garantiza que el padreCodigo
  // ya exista al crear cada analítica/sintética hija.
  const registros = PLAN_RT9.map(planEntryToSeedRecord).sort(
    (a, b) => a.nivel - b.nivel || a.codigo.localeCompare(b.codigo),
  );

  console.log(
    `Plan RT9: ${registros.length} cuentas (${registros.filter((r) => r.tipo === "SINTETICA").length} sintéticas / ${registros.filter((r) => r.tipo === "ANALITICA").length} analíticas). Modo: ${apply ? "APPLY" : "DRY-RUN"}`,
  );

  if (!apply) {
    console.log("(dry-run — no se escribe. Re-ejecutar con --apply para sembrar.)");
    for (const r of registros.slice(0, 8)) {
      console.log(`  ${r.codigo.padEnd(11)} ${r.tipo[0]} ${r.naturaleza[0]} ${r.nombre}`);
    }
    console.log(`  … (+${Math.max(0, registros.length - 8)} más)`);
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let creadas = 0;
  let actualizadas = 0;
  try {
    for (const r of registros) {
      const existente = await prisma.cuentaContable.findUnique({
        where: { codigo: r.codigo },
        select: { id: true },
      });
      const data = {
        nombre: r.nombre,
        tipo: r.tipo,
        categoria: r.categoria,
        nivel: r.nivel,
        padreCodigo: r.padreCodigo,
        activa: r.activa,
        naturaleza: r.naturaleza,
        moneda: r.moneda,
        rubroEECC: r.rubroEECC,
      };
      await prisma.cuentaContable.upsert({
        where: { codigo: r.codigo },
        create: { codigo: r.codigo, ...data },
        update: data,
      });
      if (existente) actualizadas++;
      else creadas++;
    }
    console.log(`✅ Seed RT9 aplicado: ${creadas} creadas, ${actualizadas} actualizadas.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
