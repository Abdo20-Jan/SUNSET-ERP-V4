/**
 * Limpieza de cuentas contables huérfanas del plan ANTIGUO tras instalar RT9
 * (rebuild 2026-06-17). Post-wipe + post `seed-plan-rt9 --apply`, el plan tiene
 * las 164 cuentas RT9 + ~102 cuentas viejas que no están en `PLAN_RT9`.
 *
 * Borra las viejas (no-RT9) PRESERVANDO:
 *  - Cualquier cuenta referenciada por `CuentaBancaria.cuentaContableId` (las
 *    cuentas analíticas de banco 1.1.2.1x, válidas bajo el sintético RT9 1.1.2).
 *  - (defensivo) cualquier cuenta que tenga FK entrante viva de otra tabla.
 *
 * Borra hijas antes que padres (orden por profundidad de código desc) para
 * respetar la self-FK `padreCodigo`. DRY-RUN por defecto; `--apply` borra.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PLAN_RT9 } from "@/lib/services/plan-de-cuentas";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const rt9 = new Set(PLAN_RT9.map((c) => c.codigo));

    // Cuentas referenciadas por bancos: NO se tocan (FK viva + válidas en RT9).
    const bancos = await prisma.cuentaBancaria.findMany({
      select: { cuentaContable: { select: { codigo: true } } },
    });
    const preservarPorBanco = new Set(bancos.map((b) => b.cuentaContable.codigo));

    const todas = await prisma.cuentaContable.findMany({
      select: { id: true, codigo: true, nombre: true },
    });

    const orfanas = todas.filter((c) => !rt9.has(c.codigo) && !preservarPorBanco.has(c.codigo));

    console.log(`Plan en DB: ${todas.length} cuentas · RT9 canónicas: ${rt9.size}`);
    console.log(
      `Preservadas por banco (no-RT9 pero con FK viva): ${[...preservarPorBanco].filter((c) => !rt9.has(c)).join(", ") || "(ninguna)"}`,
    );
    console.log(`Huérfanas a borrar: ${orfanas.length}. Modo: ${apply ? "APPLY" : "DRY-RUN"}\n`);
    for (const c of orfanas) console.log(`   - ${c.codigo.padEnd(12)} ${c.nombre}`);

    if (!apply) {
      console.log("\nDRY-RUN: nada borrado. Reejecutar con --apply.\n");
      return;
    }

    // Hijas antes que padres: más profundas (más segmentos) primero.
    const ordenadas = [...orfanas].sort(
      (a, b) => b.codigo.split(".").length - a.codigo.split(".").length,
    );
    let borradas = 0;
    for (const c of ordenadas) {
      await prisma.cuentaContable.delete({ where: { id: c.id } });
      borradas++;
    }

    const quedan = await prisma.cuentaContable.count();
    const fuera = (await prisma.cuentaContable.findMany({ select: { codigo: true } })).filter(
      (c) => !rt9.has(c.codigo),
    );
    console.log(`\n✅ ${borradas} huérfanas borradas. Plan ahora: ${quedan} cuentas.`);
    console.log(
      `   No-RT9 restantes (deberían ser sólo bancos): ${fuera.map((c) => c.codigo).join(", ") || "(ninguna)"}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
