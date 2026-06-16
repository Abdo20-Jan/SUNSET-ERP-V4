import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// getBalanceSumasYSaldos debe firmar el saldo por la NATURALEZA de la cuenta,
// no por su categoría. Dos cuentas ACTIVO que reciben el MISMO haber deben
// quedar con signos OPUESTOS según su naturaleza:
//   - regularizadora (contra-activo, naturaleza ACREEDOR) → saldo POSITIVO
//   - cuenta común (naturaleza DEUDOR)                     → saldo NEGATIVO
// Con la lógica vieja (signo derivado sólo de la categoría ACTIVO=debe-haber)
// AMBAS darían −100, escondiendo el saldo de la regularizadora.

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

import { getBalanceSumasYSaldos } from "@/lib/services/balance-sumas-saldos";

const FECHA = new Date("2025-06-15T12:00:00.000Z");

function findNode(
  roots: Awaited<ReturnType<typeof getBalanceSumasYSaldos>>["root"],
  codigo: string,
): { saldoFinal: string } | undefined {
  for (const n of roots) {
    if (n.codigo === codigo) return n;
    if (n.children) {
      const hit = findNode(n.children, codigo);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe("getBalanceSumasYSaldos — signo por naturaleza (regularizadoras)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  }, 180_000);

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    await db.reset(["LineaAsiento", "Asiento", "CuentaContable", "PeriodoContable"]);
  });

  it("firma ACTIVO/ACREEDOR positivo y ACTIVO/DEUDOR negativo ante el mismo haber", async () => {
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T23:59:59.999Z"),
      },
    });

    // Regularizadora: ACTIVO pero naturaleza ACREEDOR (p. ej. Depreciación Acum.)
    const regularizadora = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.2.1.09",
        nombre: "(–) Depreciación Acumulada Bienes de Uso",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
        naturaleza: "ACREEDOR",
      },
    });
    // Cuenta ACTIVO común (naturaleza DEUDOR).
    const comun = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.2.1.08",
        nombre: "Máquinas y Equipos",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
        naturaleza: "DEUDOR",
      },
    });
    // Contrapartida EGRESO para balancear el asiento.
    const gasto = await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.9.1.09",
        nombre: "Depreciación de Bienes de Uso",
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
        naturaleza: "DEUDOR",
      },
    });

    await db.prisma.asiento.create({
      data: {
        numero: 1,
        fecha: FECHA,
        descripcion: "Test naturaleza",
        estado: "CONTABILIZADO",
        totalDebe: "200.00",
        totalHaber: "200.00",
        origen: "AJUSTE",
        periodoId: periodo.id,
        lineas: {
          create: [
            { cuentaId: gasto.id, debe: "200.00", haber: "0.00" },
            { cuentaId: regularizadora.id, debe: "0.00", haber: "100.00" },
            { cuentaId: comun.id, debe: "0.00", haber: "100.00" },
          ],
        },
      },
    });

    const { root } = await getBalanceSumasYSaldos({});

    // Misma corriente (haber 100) → signos OPUESTOS por naturaleza.
    expect(findNode(root, "1.2.1.09")?.saldoFinal).toBe("100.00");
    expect(findNode(root, "1.2.1.08")?.saldoFinal).toBe("-100.00");
    // Sanidad: el gasto (DEUDOR) con debe 200 da +200.
    expect(findNode(root, "5.9.1.09")?.saldoFinal).toBe("200.00");
  });
});
