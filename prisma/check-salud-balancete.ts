import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { detectarAnomaliasBalancete } from "../src/lib/services/salud-balancete";
import { cargarSaldosParaSalud } from "../src/lib/services/salud-balancete-loader";

/**
 * Check de salud del balancete (read-only). Carga los saldos contabilizados por
 * cuenta y reporta las anomalías de signo invertido (ACTIVO con saldo acreedor,
 * etc.) que NO son saldos a favor comerciales ni regularizadoras.
 *
 * Pensado para correr en CI/cron como alerta del anti-patrón "flag/etapa ligada
 * sin el proceso-puente operacional". Sale con código 1 si hay anomalías.
 *
 * Uso: pnpm tsx prisma/check-salud-balancete.ts
 */

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  const saldos = await cargarSaldosParaSalud(db);

  const anomalias = detectarAnomaliasBalancete(saldos).sort(
    (a, b) => Math.abs(Number.parseFloat(b.saldo)) - Math.abs(Number.parseFloat(a.saldo)),
  );

  console.log(`\n=== SALUD DEL BALANCETE (${saldos.length} cuentas analizadas) ===`);
  if (anomalias.length === 0) {
    console.log("✓ Sin anomalías: ninguna cuenta analítica con saldo de signo invertido.");
    return 0;
  }

  console.log(`✗ ${anomalias.length} anomalía(s) detectada(s):\n`);
  for (const a of anomalias) {
    console.log(`  ${a.codigo.padEnd(12)} ${a.saldo.padStart(18)}  ${a.motivo}`);
  }
  console.log("\n   → Cuentas de ACTIVO con saldo acreedor (o viceversa) que no son");
  console.log("     saldos a favor comerciales: indican un proceso-puente faltante.");
  return 1;
}

main()
  .then(async (code) => {
    await db.$disconnect();
    process.exit(code);
  })
  .catch(async (e) => {
    console.error("ERROR:", e);
    await db.$disconnect();
    process.exit(2);
  });
