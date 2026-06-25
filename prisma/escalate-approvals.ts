/**
 * PR-012 — Entry-point del cron de escalonamiento de aprobaciones (AUTO-01).
 *
 * Llama `procesarEscalonamientos(ahora)` del motor (`@/lib/services/aprobaciones`)
 * y loguea el resumen. Es el ÚNICO lugar que materializa `new Date()` — el motor
 * recibe el tiempo como parámetro (determinismo en los tests).
 *
 * INERTE por defecto: si `APPROVALS_ENABLED` no está en "true", no procesa nada
 * y sale 0 (no-op limpio). El workflow `escalation-approvals.yml` que lo invoca
 * es `workflow_dispatch`-only (SIN schedule), así que en la práctica el cron no
 * corre solo. Para habilitarlo de verdad: setear `APPROVALS_ENABLED=true` y
 * agregar un bloque `schedule:` (fuera del alcance de PR-012).
 *
 * Uso:
 *   pnpm db:escalate-approvals
 *
 * Exit code: 0 ok (incluye no-op por flag off) · 2 error fatal.
 */

import "dotenv/config";

import { isApprovalsEnabled } from "../src/lib/features";
import { procesarEscalonamientos } from "../src/lib/services/aprobaciones";

async function main(): Promise<void> {
  if (!isApprovalsEnabled()) {
    console.log("APPROVALS_ENABLED=off → motor inerte; nada que procesar.");
    process.exit(0);
  }

  const ahora = new Date();
  const resultados = await procesarEscalonamientos(ahora);

  const resumen = resultados.reduce<Record<string, number>>((acc, r) => {
    acc[r.accion] = (acc[r.accion] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `Escalonamiento @ ${ahora.toISOString()} · ${resultados.length} solicitud(es) abierta(s) · ${JSON.stringify(resumen)}`,
  );
  for (const r of resultados) {
    if (r.accion === "ninguna") continue;
    const banda = r.banda ? ` ${r.banda}%` : "";
    const nivel = r.nivel ? ` nivel=${r.nivel}` : "";
    const dest = r.destinatarios?.length ? ` → ${r.destinatarios.join(", ")}` : "";
    console.log(`  - ${r.solicitudId}: ${r.accion}${banda}${nivel}${dest}`);
  }
  process.exit(0);
}

// Sólo auto-ejecuta como script (tsx/CLI), no al importarse desde un test.
const ejecutadoComoScript =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;
if (ejecutadoComoScript) {
  main().catch((err: unknown) => {
    console.error("✗ Error fatal en escalonamiento:", err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
