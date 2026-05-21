import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@/generated/prisma/client";
import { ITEM_DESPACHO_PARTIAL_DDL } from "../../prisma/partial-indexes-despacho";

// Banco efímero respaldado por Testcontainers para los escenarios e2e.
//
// Es el MISMO patrón que `test/db.ts` (usado por la suite vitest), replicado
// acá para que el harness Playwright sea autocontenido y NO dependa de imports
// de `test/` (que vitest aliasa `server-only`). Cada spec levanta su propio
// Postgres en `test.beforeAll`, aplica el schema con `prisma db push`, reaplica
// los índices PARCIALES + el CHECK de ItemDespacho (que `db push` no
// materializa) y devuelve un `PrismaClient` apuntando al contenedor.
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

  // `db push` es el flujo del proyecto (no hay carpeta prisma/migrations).
  // El cwd del proceso es la raíz del repo, así que el schema se resuelve solo.
  execFileSync("pnpm", ["exec", "prisma", "db", "push", "--accept-data-loss", "--url", url], {
    cwd: resolve(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  // `db push` no materializa los índices PARCIALES ni el CHECK de ItemDespacho.
  // Reaplicarlos acá es OBLIGATORIO para que la BD e2e tenga la MISMA unicidad
  // que producción (de lo contrario los tests de concurrencia darían falso-OK).
  for (const { sql } of ITEM_DESPACHO_PARTIAL_DDL) {
    await prisma.$executeRawUnsafe(sql);
  }

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
