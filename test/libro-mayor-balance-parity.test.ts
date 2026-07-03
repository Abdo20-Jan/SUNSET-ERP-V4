import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// CONT-02 / PR-028 — paridad Libro Mayor × Balance de Sumas y Saldos sobre BD
// real (Testcontainers). El árbol del Plan de Cuentas toma su columna Saldo
// del balance; la FWW embebida toma sus números de getLibroMayor. Para
// cuentas NO regularizadoras ambos servicios deben coincidir en
// debe/haber/saldoFinal (mismo rango). Para REGULARIZADORAS existe una
// divergencia de signo PRE-existente entre los dos servicios del motor
// (getLibroMayor signa por categoría vía saldoPorCategoria; el balance signa
// por naturaleza efectiva) — este test la DOCUMENTA con un assert explícito.
// NO corregirla acá: sería tocar el motor (restricción dura del PR-028).
//
// Seed por prisma DIRECTO (el motor de asientos no se invoca — sólo lectura).

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

import { getLibroMayor } from "@/lib/services/reportes";
import { type BalanceNode, getBalanceSumasYSaldos } from "@/lib/services/balance-sumas-saldos";

const FECHA = new Date("2026-06-15T12:00:00.000Z");
const HASTA = new Date("2026-06-30T23:59:59.999Z");

function findNode(nodes: BalanceNode[], codigo: string): BalanceNode | null {
  for (const n of nodes) {
    if (n.codigo === codigo) return n;
    const hit = n.children ? findNode(n.children, codigo) : null;
    if (hit) return hit;
  }
  return null;
}

describe("paridad Libro Mayor × Balance (PR-028)", () => {
  let db: TestDb;
  let cajaId: number;
  let ventasId: number;
  let depreciacionId: number;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);

    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2026-06",
        nombre: "Junio 2026",
        fechaInicio: new Date("2026-06-01T00:00:00.000Z"),
        fechaFin: new Date("2026-06-30T23:59:59.999Z"),
        estado: "ABIERTO",
      },
    });

    // Mini-plan: 2 sintéticas raíz + 3 analíticas (2 normales + 1
    // regularizadora ACTIVO con naturaleza ACREEDOR explícita).
    await db.prisma.cuentaContable.create({
      data: { codigo: "1", nombre: "ACTIVO", tipo: "SINTETICA", categoria: "ACTIVO", nivel: 1 },
    });
    await db.prisma.cuentaContable.create({
      data: { codigo: "4", nombre: "INGRESOS", tipo: "SINTETICA", categoria: "INGRESO", nivel: 1 },
    });
    const caja = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.01",
        nombre: "Caja",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 3,
        padreCodigo: "1",
      },
    });
    const ventas = await db.prisma.cuentaContable.create({
      data: {
        codigo: "4.1.01",
        nombre: "Ventas",
        tipo: "ANALITICA",
        categoria: "INGRESO",
        nivel: 3,
        padreCodigo: "4",
      },
    });
    const depreciacion = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.2.01",
        nombre: "Depreciación acumulada",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 3,
        padreCodigo: "1",
        naturaleza: "ACREEDOR",
      },
    });
    cajaId = caja.id;
    ventasId = ventas.id;
    depreciacionId = depreciacion.id;

    // Asiento 1 (CONTABILIZADO): Caja 150 a Ventas 150.
    await db.prisma.asiento.create({
      data: {
        numero: 1,
        fecha: FECHA,
        descripcion: "Venta contado",
        estado: "CONTABILIZADO",
        origen: "MANUAL",
        moneda: "ARS",
        tipoCambio: "1",
        totalDebe: "150",
        totalHaber: "150",
        periodoId: periodo.id,
        lineas: {
          create: [
            { cuentaId: caja.id, debe: "150", haber: "0" },
            { cuentaId: ventas.id, debe: "0", haber: "150" },
          ],
        },
      },
    });
    // Asiento 2 (CONTABILIZADO): Caja 30 a Depreciación acumulada 30 (toca la
    // regularizadora por el haber — su lado "natural").
    await db.prisma.asiento.create({
      data: {
        numero: 2,
        fecha: FECHA,
        descripcion: "Ajuste regularizadora",
        estado: "CONTABILIZADO",
        origen: "AJUSTE",
        moneda: "ARS",
        tipoCambio: "1",
        totalDebe: "30",
        totalHaber: "30",
        periodoId: periodo.id,
        lineas: {
          create: [
            { cuentaId: caja.id, debe: "30", haber: "0" },
            { cuentaId: depreciacion.id, debe: "0", haber: "30" },
          ],
        },
      },
    });
    // Asiento 3 BORRADOR: NO debe contar en ninguno de los dos servicios.
    await db.prisma.asiento.create({
      data: {
        numero: 3,
        fecha: FECHA,
        descripcion: "Borrador — no cuenta",
        estado: "BORRADOR",
        origen: "MANUAL",
        moneda: "ARS",
        tipoCambio: "1",
        totalDebe: "999",
        totalHaber: "999",
        periodoId: periodo.id,
        lineas: {
          create: [
            { cuentaId: caja.id, debe: "999", haber: "0" },
            { cuentaId: ventas.id, debe: "0", haber: "999" },
          ],
        },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("cuenta ACTIVO no regularizadora: debe/haber/saldoFinal idénticos", async () => {
    const [mayor, balance] = await Promise.all([
      getLibroMayor(cajaId, { fechaHasta: HASTA }),
      getBalanceSumasYSaldos({ fechaHasta: HASTA }),
    ]);
    const node = findNode(balance.root, "1.1.01");

    expect(node).not.toBeNull();
    expect(mayor.totalDebe.toFixed(2)).toBe(node?.debe);
    expect(mayor.totalHaber.toFixed(2)).toBe(node?.haber);
    expect(mayor.saldoFinal.toFixed(2)).toBe(node?.saldoFinal);
    expect(mayor.saldoFinal.toFixed(2)).toBe("180.00"); // 150 + 30, sólo CONTABILIZADO
  });

  it("cuenta INGRESO no regularizadora: saldoFinal idéntico (naturaleza acreedora)", async () => {
    const [mayor, balance] = await Promise.all([
      getLibroMayor(ventasId, { fechaHasta: HASTA }),
      getBalanceSumasYSaldos({ fechaHasta: HASTA }),
    ]);
    const node = findNode(balance.root, "4.1.01");

    expect(mayor.saldoFinal.toFixed(2)).toBe(node?.saldoFinal);
    expect(mayor.saldoFinal.toFixed(2)).toBe("150.00");
  });

  it("la sintética del árbol es el roll-up del balance (nunca recomputado en UI)", async () => {
    const balance = await getBalanceSumasYSaldos({ fechaHasta: HASTA });
    const activo = findNode(balance.root, "1");

    // Comportamiento REAL del motor (documentado, no juzgado acá): el roll-up
    // suma el saldoFinal de cada hijo EN SU PROPIA naturaleza — Caja (DEUDOR)
    // +180 y Depreciación (ACREEDOR) +30 entran ambos positivos: 210. La
    // columna Saldo del árbol espeja este número tal cual (pass-through);
    // cualquier cambio de semántica del roll-up es del motor, no de la UI.
    expect(activo?.saldoFinal).toBe("210.00");
  });

  it("REGULARIZADORA: divergencia de signo DOCUMENTADA entre los dos servicios", async () => {
    const [mayor, balance] = await Promise.all([
      getLibroMayor(depreciacionId, { fechaHasta: HASTA }),
      getBalanceSumasYSaldos({ fechaHasta: HASTA }),
    ]);
    const node = findNode(balance.root, "1.2.01");

    // Balance signa por naturaleza EFECTIVA (ACREEDOR): haber-debe = +30.
    expect(node?.saldoFinal).toBe("30.00");
    // getLibroMayor signa por CATEGORÍA (ACTIVO→DEUDOR): debe-haber = -30.
    // Divergencia PRE-existente del motor — documentada, NO corregida acá
    // (corregirla = tocar reportes/shared.ts, fuera del alcance UI-only del
    // PR-028; candidata a follow-up del dueño).
    expect(mayor.saldoFinal.toFixed(2)).toBe("-30.00");
  });
});
