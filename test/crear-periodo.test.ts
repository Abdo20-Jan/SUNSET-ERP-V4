import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Action crearPeriodo: valida unicidad de código y NO solapamiento de rangos
// contra la DB (resolverPeriodo hace findFirst por contención → rangos
// superpuestos volverían ambiguo a qué período va un asiento).

const h = vi.hoisted(() => {
  let client: PrismaClient | undefined;
  return {
    setClient: (c: PrismaClient) => {
      client = c;
    },
    dbProxy: new Proxy(
      {},
      {
        get(_t, prop) {
          const target = client as unknown as Record<string | symbol, unknown> | undefined;
          const value = target?.[prop];
          return typeof value === "function"
            ? (value as (...args: unknown[]) => unknown).bind(client)
            : value;
        },
      },
    ),
  };
});

vi.mock("@/lib/db", () => ({ db: h.dbProxy }));
vi.mock("@/lib/auth-guard", () => ({
  requireAdmin: async () => ({ ok: true, userId: "test-admin" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { crearPeriodo } from "@/lib/actions/periodos";

describe("crearPeriodo", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.reset(["LineaAsiento", "Asiento", "PeriodoContable"]);
  });

  it("crea un período ABIERTO con rango válido", async () => {
    const r = await crearPeriodo({
      codigo: "2025",
      nombre: "Ejercicio 2025",
      fechaInicio: "2025-01-01",
      fechaFin: "2025-12-31",
    });
    expect(r.ok).toBe(true);
    const p = await db.prisma.periodoContable.findUnique({ where: { codigo: "2025" } });
    expect(p?.estado).toBe("ABIERTO");
    expect(p?.fechaInicio.toISOString().slice(0, 10)).toBe("2025-01-01");
  });

  it("rechaza código duplicado", async () => {
    await crearPeriodo({
      codigo: "2025",
      nombre: "Ejercicio 2025",
      fechaInicio: "2025-01-01",
      fechaFin: "2025-12-31",
    });
    const r = await crearPeriodo({
      codigo: "2025",
      nombre: "Otro",
      fechaInicio: "2026-01-01",
      fechaFin: "2026-12-31",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Ya existe/);
  });

  it("rechaza rango superpuesto con un período existente", async () => {
    await crearPeriodo({
      codigo: "2025",
      nombre: "Ejercicio 2025",
      fechaInicio: "2025-01-01",
      fechaFin: "2025-12-31",
    });
    const r = await crearPeriodo({
      codigo: "2025-H2",
      nombre: "Segundo semestre",
      fechaInicio: "2025-06-01",
      fechaFin: "2026-06-30",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/superpone/);
  });

  it("acepta períodos adyacentes sin solapamiento", async () => {
    await crearPeriodo({
      codigo: "2025-01",
      nombre: "Enero 2025",
      fechaInicio: "2025-01-01",
      fechaFin: "2025-01-31",
    });
    const r = await crearPeriodo({
      codigo: "2025-02",
      nombre: "Febrero 2025",
      fechaInicio: "2025-02-01",
      fechaFin: "2025-02-28",
    });
    expect(r.ok).toBe(true);
  });

  it("rechaza inicio > fin", async () => {
    const r = await crearPeriodo({
      codigo: "X",
      nombre: "Inválido",
      fechaInicio: "2025-12-31",
      fechaFin: "2025-01-01",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/inicio/);
  });

  it("rechaza código vacío", async () => {
    const r = await crearPeriodo({
      codigo: "  ",
      nombre: "Sin código",
      fechaInicio: "2025-01-01",
      fechaFin: "2025-12-31",
    });
    expect(r.ok).toBe(false);
  });
});
