import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Banco de prueba efímero respaldado por Testcontainers.
 *
 * Cada suite que necesite una BD real llama `createTestDb()` en `beforeAll`
 * y `db.stop()` en `afterAll`. Levanta un Postgres en contenedor, aplica el
 * schema con `prisma migrate deploy` (corre las migraciones reales de
 * prisma/migrations, incluyendo el baseline 0_init con sus índices PARCIALES
 * y el CHECK de ItemDespacho/ItemContenedor) y devuelve un `PrismaClient`
 * apuntando a ese contenedor.
 *
 * Aislamiento: un contenedor por suite. Para limpiar entre tests dentro de
 * una misma suite, usar `db.reset(tablas)`.
 */
export interface TestDb {
  prisma: PrismaClient;
  /** URL de conexión del contenedor (útil para scripts que reciben env). */
  url: string;
  /** TRUNCATE … RESTART IDENTITY CASCADE de las tablas indicadas. */
  reset: (tables: readonly string[]) => Promise<void>;
  /** Desconecta el client y detiene el contenedor. */
  stop: () => Promise<void>;
}

// Imagen alineada con prod (Railway corre Postgres 18).
const POSTGRES_IMAGE = "postgres:18-alpine";

export async function createTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const url = container.getConnectionUri();

  // Aplica el schema corriendo las migraciones reales (baseline 0_init + las
  // que sigan). Esto da PARIDAD TOTAL con producción: la BD de prueba se
  // construye con el mismo artefacto que se aplica en prod (migrate deploy),
  // validando las migraciones en cada corrida. `DATABASE_URL` en el env
  // alimenta el datasource de prisma.config.ts.
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: url },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  // Los índices PARCIALES y el CHECK de ItemDespacho/ItemContenedor ya vienen
  // del baseline 0_init (migrate deploy los aplicó). No hace falta reaplicarlos.

  const reset = async (tables: readonly string[]): Promise<void> => {
    if (tables.length > 0) {
      const list = tables.map((t) => `"${t}"`).join(", ");
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
    }
    // Los tests mockean `auth` con un id de usuario fijo ("user-uuid"). El guard
    // de sesión (requireSessionUser) exige que ese User exista en la base antes
    // de escribir cualquier FK (createdById/ownerId/usuarioId); si no, redirige
    // a /login y la action nunca corre. Lo garantizamos acá (idempotente) tras
    // cada reset para que el escenario por defecto sea "sesión válida".
    await prisma.user.upsert({
      where: { id: "user-uuid" },
      update: {},
      create: {
        id: "user-uuid",
        username: "tester",
        passwordHash: "x",
        nombre: "Tester",
        role: "ADMIN",
      },
    });
  };

  const stop = async (): Promise<void> => {
    await prisma.$disconnect();
    await container.stop();
  };

  return { prisma, url, reset, stop };
}
