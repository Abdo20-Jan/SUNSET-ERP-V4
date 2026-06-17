import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@/generated/prisma/client";

// Banco efímero respaldado por Testcontainers para los escenarios e2e.
//
// Es el MISMO patrón que `test/db.ts` (usado por la suite vitest), replicado
// acá para que el harness Playwright sea autocontenido y NO dependa de imports
// de `test/` (que vitest aliasa `server-only`). Cada spec levanta su propio
// Postgres en `test.beforeAll`, aplica el schema con `prisma migrate deploy`
// (corre las migraciones reales, incluyendo el baseline 0_init con sus índices
// PARCIALES y el CHECK de ItemDespacho/ItemContenedor) y devuelve un
// `PrismaClient` apuntando al contenedor.
//
// Requiere Docker corriendo (igual que la suite vitest). En CI el runner ubuntu
// ya trae Docker; en local hay que tener Docker Desktop activo.

export interface E2eDb {
  prisma: PrismaClient;
  url: string;
  reset: (tables: readonly string[]) => Promise<void>;
  stop: () => Promise<void>;
}

// Imagen alineada con prod (Railway corre Postgres 18).
const POSTGRES_IMAGE = "postgres:18-alpine";

export async function createE2eDb(): Promise<E2eDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const url = container.getConnectionUri();

  // Corre las migraciones reales (baseline 0_init + las que sigan) para tener
  // PARIDAD TOTAL con producción. El cwd es la raíz del repo (resuelve el
  // schema y prisma/migrations); `DATABASE_URL` alimenta el datasource.
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: resolve(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  // Los índices PARCIALES y el CHECK de ItemDespacho/ItemContenedor ya vienen
  // del baseline 0_init (migrate deploy los aplicó). No hace falta reaplicarlos.

  const reset = async (tables: readonly string[]): Promise<void> => {
    if (tables.length === 0) return;
    const list = tables.map((t) => `"${t}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
  };

  const stop = async (): Promise<void> => {
    await prisma.$disconnect();
    await container.stop();
  };

  return { prisma, url, reset, stop };
}
