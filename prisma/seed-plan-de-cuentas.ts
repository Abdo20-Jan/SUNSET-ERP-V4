/**
 * Seed del plan de cuentas desde `PLAN_CUENTAS` (fuente única estructurada en
 * `src/lib/services/plan-de-cuentas.ts`, dato en `plan-de-cuentas.data.ts`).
 * Modelo de 9 clases del Excel maestro `PLANO DE CONTAS FINAL.xlsx` (631 cuentas).
 *
 * - Idempotente: upsert por `codigo`.
 * - Siembra PADRES antes que HIJOS (orden por `nivel`, luego `orden`) para
 *   satisfacer la FK self-relation `padreCodigo → codigo`.
 * - Autovalida el plan (`validarPlan`) antes de tocar la DB; aborta si hay
 *   inconsistencias (huérfanas, clase incoherente, tipo×imputación, etc.).
 * - DRY-RUN por defecto; sólo `--apply` escribe.
 *
 * Uso:
 *   pnpm tsx prisma/seed-plan-de-cuentas.ts            # dry-run (no escribe)
 *   DATABASE_URL=<url> pnpm tsx prisma/seed-plan-de-cuentas.ts --apply
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PLAN_CUENTAS, planEntryToSeedRecord, validarPlan } from "@/lib/services/plan-de-cuentas";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const problemas = validarPlan(PLAN_CUENTAS);
  if (problemas.length > 0) {
    console.error(`❌ PLAN_CUENTAS inconsistente (${problemas.length}) — abortando:`);
    for (const p of problemas) console.error(`  [${p.regla}] ${p.codigo}: ${p.detalle}`);
    process.exit(1);
  }

  // Padres antes que hijos: el orden por nivel garantiza que el padreCodigo ya
  // exista al crear cada cuenta hija; `orden` desempata de forma estable.
  const registros = PLAN_CUENTAS.map(planEntryToSeedRecord).sort(
    (a, b) => a.nivel - b.nivel || a.orden - b.orden,
  );

  const sint = registros.filter((r) => r.tipo === "SINTETICA").length;
  console.log(
    `Plan de cuentas: ${registros.length} cuentas (${sint} sintéticas / ${registros.length - sint} analíticas). Modo: ${apply ? "APPLY" : "DRY-RUN"}`,
  );

  if (!apply) {
    console.log("(dry-run — no se escribe. Re-ejecutar con --apply para sembrar.)");
    for (const r of registros.slice(0, 8)) {
      console.log(`  ${r.codigo.padEnd(13)} ${r.tipo[0]} ${r.naturaleza.padEnd(16)} ${r.nombre}`);
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
        clase: r.clase,
        clasificacion: r.clasificacion,
        orden: r.orden,
        nivel: r.nivel,
        padreCodigo: r.padreCodigo,
        activa: r.activa,
        naturaleza: r.naturaleza,
        moneda: r.moneda,
        imputacion: r.imputacion,
        regularizadora: r.regularizadora,
        bimonetaria: r.bimonetaria,
        monedaExtranjera: r.monedaExtranjera,
        enEspecie: r.enEspecie,
        inventariable: r.inventariable,
        sistema: r.sistema,
        dinamica: r.dinamica,
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
    console.log(`✅ Seed aplicado: ${creadas} creadas, ${actualizadas} actualizadas.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
