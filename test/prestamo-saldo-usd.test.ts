import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// E4d — Saldo del PRÉSTAMO en USD (validar + exhibir). Cierra la E4.
//
// El saldo del préstamo se calculaba sólo en ARS (haber − debe). Para un
// préstamo USD eso causaba (1) una rejección FALSA al amortizar el principal
// entero cuando el TC subió (intento ARS al TC pago vs saldo ARS al TC alta)
// y (2) presentación en ARS al TC histórico en vez de USD invariante.
//
// El saldo USD se deriva de montoOrigen (canónico E5): es invariante a TC y
// la diferencia cambiaria va a 9.2.x, NO a la cuenta del préstamo. Por eso la
// cuenta del préstamo queda valuada al TC de alta y saldoUsd = Σ montoOrigen
// (haber) − Σ montoOrigen(debe).

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
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-uuid" } })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { AsientoEstado, Moneda, PrestamoClasificacion } from "@/generated/prisma/client";
import {
  calcularSaldoPrestamoConMoneda,
  calcularSaldosPrestamosConMoneda,
  validarSaldoSuficientePrestamo,
} from "@/lib/services/prestamo";
import { contabilizarAsiento, crearAsientoPrestamo } from "@/lib/services/asiento-automatico";
import { crearMovimientoTesoreriaAction } from "@/lib/actions/movimientos-tesoreria";

let testDb: TestDb;
let prisma: PrismaClient;

const TABLES = [
  "LineaAsiento",
  "Asiento",
  "MovimientoTesoreria",
  "PrestamoExterno",
  "CuentaBancaria",
  "CuentaContable",
  "PeriodoContable",
] as const;

const FECHA = new Date("2025-06-15T12:00:00.000Z");

beforeAll(async () => {
  testDb = await createTestDb();
  prisma = testDb.prisma;
  h.setClient(prisma);
}, 120_000);

afterAll(async () => {
  await testDb?.stop();
});

let periodoId: number;

beforeEach(async () => {
  await testDb.reset(TABLES);
  const periodo = await prisma.periodoContable.create({
    data: {
      codigo: "2025-06",
      nombre: "Junio 2025",
      fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
      fechaFin: new Date("2025-06-30T23:59:59.000Z"),
      estado: "ABIERTO",
    },
  });
  periodoId = periodo.id;
  // Sintéticas padre (clase 9 ULTRA) para auto-create de la diferencia cambiaria.
  await prisma.cuentaContable.createMany({
    data: [
      {
        codigo: "9",
        nombre: "RESULTADOS FINANCIEROS Y POR TENENCIA",
        tipo: "SINTETICA",
        categoria: "INGRESO",
        nivel: 1,
      },
      {
        codigo: "9.2",
        nombre: "DIFERENCIAS DE CAMBIO",
        tipo: "SINTETICA",
        categoria: "INGRESO",
        nivel: 2,
      },
    ],
  });
});

let cuentaSeq = 0;
async function mkCuenta(
  nombre: string,
  categoria: "ACTIVO" | "PASIVO" | "EGRESO",
): Promise<number> {
  cuentaSeq += 1;
  const codigo = `7.7.7.${String(cuentaSeq).padStart(2, "0")}`;
  const c = await prisma.cuentaContable.create({
    data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4 },
  });
  return c.id;
}

let asientoSeq = 0;
type LineaSeed = {
  cuentaId: number;
  debe?: string;
  haber?: string;
  monedaOrigen?: Moneda;
  montoOrigen?: string;
  tipoCambioOrigen?: string;
};

async function crearAsientoContab(lineas: LineaSeed[]): Promise<void> {
  asientoSeq += 1;
  const totalDebe = lineas.reduce((s, l) => s.plus(new Decimal(l.debe ?? 0)), new Decimal(0));
  const totalHaber = lineas.reduce((s, l) => s.plus(new Decimal(l.haber ?? 0)), new Decimal(0));
  await prisma.asiento.create({
    data: {
      numero: asientoSeq,
      fecha: FECHA,
      descripcion: "seed",
      estado: AsientoEstado.CONTABILIZADO,
      origen: "TESORERIA",
      moneda: Moneda.ARS,
      tipoCambio: 1,
      totalDebe: totalDebe.toFixed(2),
      totalHaber: totalHaber.toFixed(2),
      periodoId,
      lineas: {
        create: lineas.map((l) => ({
          cuentaId: l.cuentaId,
          debe: l.debe ?? "0",
          haber: l.haber ?? "0",
          monedaOrigen: l.monedaOrigen ?? null,
          montoOrigen: l.montoOrigen ?? null,
          tipoCambioOrigen: l.tipoCambioOrigen ?? null,
        })),
      },
    },
  });
}

// ============================================================
// Servicio: calcularSaldoPrestamoConMoneda
// ============================================================

describe("calcularSaldoPrestamoConMoneda", () => {
  it("préstamo USD recién creado: saldoUsd = principal, saldoArs = principal × TC alta", async () => {
    const banco = await mkCuenta("BANCO USD", "ACTIVO");
    const prestamo = await mkCuenta("PRÉSTAMO ACME USD", "PASIVO");
    // Alta: principal 20.000 USD @ TC 1000.
    await crearAsientoContab([
      { cuentaId: banco, debe: "20000000.00" },
      {
        cuentaId: prestamo,
        haber: "20000000.00",
        monedaOrigen: Moneda.USD,
        montoOrigen: "20000.00",
        tipoCambioOrigen: "1000.000000",
      },
    ]);

    const saldo = await calcularSaldoPrestamoConMoneda(prestamo);
    expect(saldo.saldoArs.toFixed(2)).toBe("20000000.00");
    expect(saldo.saldoUsd?.toFixed(2)).toBe("20000.00");
  });

  it("tras amortizar USD a TC mayor: saldoUsd invariante; saldoArs al TC de alta (diferencia en 9.2.x)", async () => {
    const banco = await mkCuenta("BANCO USD", "ACTIVO");
    const prestamo = await mkCuenta("PRÉSTAMO ACME USD", "PASIVO");
    const perdida = await mkCuenta("PÉRDIDA DIF CAMBIO", "EGRESO");
    // Alta: 20.000 USD @ 1000.
    await crearAsientoContab([
      { cuentaId: banco, debe: "20000000.00" },
      {
        cuentaId: prestamo,
        haber: "20000000.00",
        monedaOrigen: Moneda.USD,
        montoOrigen: "20000.00",
        tipoCambioOrigen: "1000.000000",
      },
    ]);
    // Amortización: 5.000 USD. La cuenta del préstamo se debita al TC alta
    // (5.000 × 1000 = 5.000.000), el banco sale al TC pago (5.000 × 1500 =
    // 7.500.000) y la pérdida (2.500.000) va a 9.2.x — NO a la cuenta del préstamo.
    await crearAsientoContab([
      {
        cuentaId: prestamo,
        debe: "5000000.00",
        monedaOrigen: Moneda.USD,
        montoOrigen: "5000.00",
        tipoCambioOrigen: "1000.000000",
      },
      { cuentaId: perdida, debe: "2500000.00" },
      { cuentaId: banco, haber: "7500000.00" },
    ]);

    const saldo = await calcularSaldoPrestamoConMoneda(prestamo);
    expect(saldo.saldoUsd?.toFixed(2)).toBe("15000.00");
    expect(saldo.saldoArs.toFixed(2)).toBe("15000000.00");
  });

  it("préstamo ARS: saldoUsd = null, saldoArs = principal", async () => {
    const banco = await mkCuenta("BANCO ARS", "ACTIVO");
    const prestamo = await mkCuenta("PRÉSTAMO LOCAL ARS", "PASIVO");
    await crearAsientoContab([
      { cuentaId: banco, debe: "1000000.00" },
      { cuentaId: prestamo, haber: "1000000.00" },
    ]);

    const saldo = await calcularSaldoPrestamoConMoneda(prestamo);
    expect(saldo.saldoUsd).toBeNull();
    expect(saldo.saldoArs.toFixed(2)).toBe("1000000.00");
  });
});

// ============================================================
// Servicio: calcularSaldosPrestamosConMoneda (batch)
// ============================================================

describe("calcularSaldosPrestamosConMoneda", () => {
  it("batch mixto: USD vigente, ARS (saldoUsd null), USD quitado (saldoUsd 0, NO null)", async () => {
    const banco = await mkCuenta("BANCO", "ACTIVO");
    const u1 = await mkCuenta("PRÉSTAMO USD VIGENTE", "PASIVO");
    const a1 = await mkCuenta("PRÉSTAMO ARS", "PASIVO");
    const u2 = await mkCuenta("PRÉSTAMO USD QUITADO", "PASIVO");

    // U1: 20.000 USD vigente.
    await crearAsientoContab([
      { cuentaId: banco, debe: "20000000.00" },
      {
        cuentaId: u1,
        haber: "20000000.00",
        monedaOrigen: Moneda.USD,
        montoOrigen: "20000.00",
        tipoCambioOrigen: "1000.000000",
      },
    ]);
    // A1: 1.000.000 ARS.
    await crearAsientoContab([
      { cuentaId: banco, debe: "1000000.00" },
      { cuentaId: a1, haber: "1000000.00" },
    ]);
    // U2: 10.000 USD alta + 10.000 USD amortización (quitado).
    await crearAsientoContab([
      { cuentaId: banco, debe: "10000000.00" },
      {
        cuentaId: u2,
        haber: "10000000.00",
        monedaOrigen: Moneda.USD,
        montoOrigen: "10000.00",
        tipoCambioOrigen: "1000.000000",
      },
    ]);
    await crearAsientoContab([
      {
        cuentaId: u2,
        debe: "10000000.00",
        monedaOrigen: Moneda.USD,
        montoOrigen: "10000.00",
        tipoCambioOrigen: "1000.000000",
      },
      { cuentaId: banco, haber: "10000000.00" },
    ]);

    const map = await calcularSaldosPrestamosConMoneda([u1, a1, u2]);
    expect(map.get(u1)?.saldoUsd?.toFixed(2)).toBe("20000.00");
    expect(map.get(a1)?.saldoUsd).toBeNull();
    expect(map.get(a1)?.saldoArs.toFixed(2)).toBe("1000000.00");
    expect(map.get(u2)?.saldoUsd?.toFixed(2)).toBe("0.00");
    expect(map.get(u2)?.saldoArs.toFixed(2)).toBe("0.00");
  });

  it("ids vacío → Map vacío", async () => {
    const map = await calcularSaldosPrestamosConMoneda([]);
    expect(map.size).toBe(0);
  });
});

// ============================================================
// Validación de saldo suficiente — currency-aware
// ============================================================

describe("validarSaldoSuficientePrestamo", () => {
  async function seedPrestamoUsd(): Promise<number> {
    const banco = await mkCuenta("BANCO USD", "ACTIVO");
    const prestamo = await mkCuenta("PRÉSTAMO ACME USD", "PASIVO");
    await crearAsientoContab([
      { cuentaId: banco, debe: "20000000.00" },
      {
        cuentaId: prestamo,
        haber: "20000000.00",
        monedaOrigen: Moneda.USD,
        montoOrigen: "20000.00",
        tipoCambioOrigen: "1000.000000",
      },
    ]);
    return prestamo;
  }

  it("USD: pagar el principal entero a TC mayor al de alta → OK (regresión: el chequeo ARS antiguo lo rechazaba)", async () => {
    const prestamo = await seedPrestamoUsd();
    const res = await validarSaldoSuficientePrestamo(prestamo, {
      monto: "20000.00",
      moneda: Moneda.USD,
      tipoCambio: "1500.000000",
    });
    expect(res.ok).toBe(true);
    expect(res.moneda).toBe(Moneda.USD);
    expect(res.saldoActual.toFixed(2)).toBe("20000.00");
  });

  it("USD: pagar más USD que el saldo → falla, moneda=USD, faltante correcto", async () => {
    const prestamo = await seedPrestamoUsd();
    const res = await validarSaldoSuficientePrestamo(prestamo, {
      monto: "25000.00",
      moneda: Moneda.USD,
      tipoCambio: "1000.000000",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("esperaba falla");
    expect(res.moneda).toBe(Moneda.USD);
    expect(res.saldoActual.toFixed(2)).toBe("20000.00");
    expect(res.intento.toFixed(2)).toBe("25000.00");
    expect(res.faltante.toFixed(2)).toBe("5000.00");
  });

  it("ARS: dentro del saldo → OK (moneda=ARS); por encima → falla en ARS", async () => {
    const banco = await mkCuenta("BANCO ARS", "ACTIVO");
    const prestamo = await mkCuenta("PRÉSTAMO LOCAL ARS", "PASIVO");
    await crearAsientoContab([
      { cuentaId: banco, debe: "1000000.00" },
      { cuentaId: prestamo, haber: "1000000.00" },
    ]);

    const ok = await validarSaldoSuficientePrestamo(prestamo, {
      monto: "400000.00",
      moneda: Moneda.ARS,
      tipoCambio: "1",
    });
    expect(ok.ok).toBe(true);
    expect(ok.moneda).toBe(Moneda.ARS);

    const fail = await validarSaldoSuficientePrestamo(prestamo, {
      monto: "1200000.00",
      moneda: Moneda.ARS,
      tipoCambio: "1",
    });
    expect(fail.ok).toBe(false);
    if (fail.ok) throw new Error("esperaba falla");
    expect(fail.moneda).toBe(Moneda.ARS);
    expect(fail.faltante.toFixed(2)).toBe("200000.00");
  });
});

// ============================================================
// Integración: crearMovimientoTesoreriaAction sobre préstamo USD
// ============================================================

describe("crearMovimientoTesoreriaAction — amortización de préstamo USD", () => {
  async function seedPrestamoRealUsd(opts: {
    principal: string;
    tcAlta: string;
  }): Promise<{ cuentaBancariaId: string; prestamoCuentaId: number }> {
    const bancoContable = await mkCuenta("BANCO USD", "ACTIVO");
    const prestamoCuentaId = await mkCuenta("PRÉSTAMO ACME USD", "PASIVO");
    const cuentaBancaria = await prisma.cuentaBancaria.create({
      data: {
        banco: "Test Bank USD",
        tipo: "CUENTA_CORRIENTE",
        moneda: Moneda.USD,
        numero: "0001-0001",
        cuentaContableId: bancoContable,
      },
    });
    const prestamo = await prisma.prestamoExterno.create({
      data: {
        prestamista: "ACME OFFSHORE",
        cuentaBancariaId: cuentaBancaria.id,
        moneda: Moneda.USD,
        principal: opts.principal,
        tipoCambio: opts.tcAlta,
        clasificacion: PrestamoClasificacion.CORTO_PLAZO,
        cuentaContableId: prestamoCuentaId,
      },
    });
    const asiento = await crearAsientoPrestamo(prestamo.id, FECHA, prisma);
    await contabilizarAsiento(asiento.id, prisma);
    return { cuentaBancariaId: cuentaBancaria.id, prestamoCuentaId };
  }

  it("amortiza el principal entero en USD a TC mayor → OK y saldoUsd → 0", async () => {
    const { cuentaBancariaId, prestamoCuentaId } = await seedPrestamoRealUsd({
      principal: "20000.00",
      tcAlta: "1000.000000",
    });

    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId,
      fecha: FECHA,
      moneda: Moneda.USD,
      tipoCambio: "1500.000000",
      lineas: [{ cuentaContableId: prestamoCuentaId, monto: "20000.00" }],
    });

    expect(res.ok).toBe(true);
    const saldo = await calcularSaldoPrestamoConMoneda(prestamoCuentaId);
    expect(saldo.saldoUsd?.toFixed(2)).toBe("0.00");
  });

  it("sobre-pagar en USD → falla con mensaje en USD", async () => {
    const { cuentaBancariaId, prestamoCuentaId } = await seedPrestamoRealUsd({
      principal: "20000.00",
      tcAlta: "1000.000000",
    });

    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId,
      fecha: FECHA,
      moneda: Moneda.USD,
      tipoCambio: "1000.000000",
      lineas: [{ cuentaContableId: prestamoCuentaId, monto: "25000.00" }],
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("esperaba falla");
    expect(res.error).toContain("USD");
    expect(res.error).not.toContain("ARS");
  });
});
