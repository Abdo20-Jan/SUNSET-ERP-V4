import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db";

// Smoke de la infra de test (PR T.0): valida la cadena completa
// contenedor Postgres → `prisma db push` → PrismaClient → query.
describe("infra de test (testcontainers + prisma)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  it("conecta al Postgres efímero", async () => {
    const rows = await db.prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    expect(rows[0]?.ok).toBe(1);
  });

  it("aplicó el schema (la tabla CuentaContable existe y está vacía)", async () => {
    const count = await db.prisma.cuentaContable.count();
    expect(count).toBe(0);
  });

  it("permite escribir y leer (round-trip de CuentaContable)", async () => {
    await db.prisma.cuentaContable.create({
      data: {
        codigo: "9.9.9.99",
        nombre: "CUENTA DE PRUEBA",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const found = await db.prisma.cuentaContable.findUnique({ where: { codigo: "9.9.9.99" } });
    expect(found?.nombre).toBe("CUENTA DE PRUEBA");

    await db.reset(["CuentaContable"]);
    expect(await db.prisma.cuentaContable.count()).toBe(0);
  });
});
