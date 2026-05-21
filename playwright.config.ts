import { defineConfig } from "@playwright/test";

/**
 * Configuración Playwright para los 5 escenarios CRÍTICOS del Comex ZPA
 * (PR 6.1). Toda la feature vive detrás de `CONTENEDOR_DESCONSOLIDACION_ENABLED`
 * (OFF en prod); los specs la prenden en `process.env` antes de ejercer los
 * services.
 *
 * ## Qué corren estos specs
 * Manejan los flujos reales de la feature (desconsolidación, despacho parcial
 * cruzado, anulación reversible, divergencia D9 y concurrencia single-shot)
 * ejecutando los **services/actions de producción** contra un Postgres efímero
 * (Testcontainers, mismo patrón que `test/db.ts`). Verifican el contrato
 * end-to-end a nivel transacción: counters de ItemContenedor, stock por
 * depósito, asientos contables y la unicidad parcial de ItemDespacho.
 *
 * ## Por qué no abren browser
 * Un e2e browser-driven necesitaría: binarios de browser (`playwright install`),
 * el server Next levantado (`next start`) y una sesión NextAuth con credenciales
 * semilladas. Eso es pesado y no determinístico en sandbox/CI liviano. Las
 * invariantes críticas de esta feature viven en los services (no en la UI), así
 * que los ejercemos directamente — el mismo enfoque que la suite vitest, pero
 * con el runner Playwright y aislados de `pnpm test`.
 *
 * ## Requisitos
 * - Docker corriendo (Testcontainers levanta `postgres:18-alpine`).
 * - `pnpm prisma generate` ejecutado (client en `src/generated/prisma`).
 *
 * Para evolucionar a browser-driven en el futuro: agregar `webServer` acá
 * (levantar `next start` con la flag ON + DB semillada), `playwright install`
 * en CI y `projects` con `chromium`. La estructura de specs queda lista.
 */
export default defineConfig({
  testDir: "./e2e",
  // Path mapping (`@/*`, `server-only`) vía tsconfig dedicado.
  tsconfig: "./e2e/tsconfig.json",
  // Cada spec levanta su propio contenedor PG → corremos en serie para no
  // saturar Docker ni los recursos del runner.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  // Boot de contenedor + `prisma db push` puede tardar; damos margen amplio.
  timeout: 180_000,
  expect: { timeout: 15_000 },
});
