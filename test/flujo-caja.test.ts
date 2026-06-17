import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// FC-1 / E5 — Flujo de Caja particionado por la MONEDA DE LA CUENTA bancaria.
//
// Bug original (auditoría FC, nota 19): getFlujoCaja particionaba por
// `asiento.moneda` y sumaba debe/haber crudos (siempre ARS desde E3). El fix
// particiona por la moneda de la cuenta banco/caja (CuentaBancaria.moneda) y
// usa montoOrigen para USD, espejando calcularSaldosCuentasBancariasEnMonedaCuenta.
// Invariante de aceptación: el saldo acumulado del reporte por moneda == la
// función-âncora cuando `hasta` cubre todo el historial.

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

import { calcularSaldosCuentasBancariasEnMonedaCuenta } from "@/lib/services/cuenta-bancaria";
import { getFlujoCaja } from "@/lib/services/reportes/flujo-caja";

const DESDE = new Date("2025-01-01T00:00:00.000Z");
const HASTA = new Date("2025-12-31T23:59:59.999Z");
const FECHA = new Date("2025-06-10T12:00:00.000Z");

type LineaSeed = {
  cuentaId: number;
  debe?: string;
  haber?: string;
  monedaOrigen?: "USD";
  montoOrigen?: string;
  tipoCambioOrigen?: string;
};

describe("FC-1 — flujo de caja particionado por moneda de la cuenta", () => {
  let db: TestDb;
  let periodoId: number;
  let numeroSeq = 0;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.reset([
      "LineaAsiento",
      "Asiento",
      "CuentaBancaria",
      "PeriodoContable",
      "CuentaContable",
    ]);
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025",
        nombre: "Ejercicio 2025",
        fechaInicio: new Date("2025-01-01T00:00:00.000Z"),
        fechaFin: new Date("2025-12-31T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
    periodoId = periodo.id;
  });

  async function mkCuenta(
    codigo: string,
    nombre: string,
    categoria: "ACTIVO" | "PASIVO" | "EGRESO" | "INGRESO",
  ): Promise<number> {
    const c = await db.prisma.cuentaContable.create({
      data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4 },
    });
    return c.id;
  }

  async function mkBanco(codigo: string, nombre: string, moneda: "ARS" | "USD"): Promise<number> {
    const id = await mkCuenta(codigo, nombre, "ACTIVO");
    await db.prisma.cuentaBancaria.create({
      data: {
        banco: nombre,
        tipo: "CUENTA_CORRIENTE",
        moneda,
        numero: codigo,
        cuentaContableId: id,
      },
    });
    return id;
  }

  async function mkAsiento(
    lineas: LineaSeed[],
    opts: { moneda?: "ARS" | "USD"; tipoCambio?: string; fecha?: Date } = {},
  ): Promise<void> {
    numeroSeq += 1;
    const totalDebe = lineas.reduce((s, l) => s + Number(l.debe ?? 0), 0);
    const totalHaber = lineas.reduce((s, l) => s + Number(l.haber ?? 0), 0);
    await db.prisma.asiento.create({
      data: {
        numero: numeroSeq,
        fecha: opts.fecha ?? FECHA,
        descripcion: `asiento ${numeroSeq}`,
        estado: "CONTABILIZADO",
        origen: "MANUAL",
        moneda: opts.moneda ?? "ARS",
        tipoCambio: opts.tipoCambio ?? "1",
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

  async function ancla(cuentaContableId: number, moneda: "ARS" | "USD"): Promise<number> {
    const saldos = await calcularSaldosCuentasBancariasEnMonedaCuenta([
      { cuentaContableId, moneda },
    ]);
    return saldos.get(cuentaContableId)?.toNumber() ?? 0;
  }

  function ultimoSaldo(flujo: {
    meses: string[];
    totales: { saldoAcumuladoPorMes: Record<string, { toNumber: () => number }> };
  }): number {
    const ultimo = flujo.meses[flujo.meses.length - 1]!;
    return flujo.totales.saldoAcumuladoPorMes[ultimo]!.toNumber();
  }

  it("1) invariante ARS puro: saldo acumulado == âncora", async () => {
    const banco = await mkBanco("1.1.2.01", "BANCO NACION ARS", "ARS");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE A", "ACTIVO");
    const proveedor = await mkCuenta("2.1.1.10", "PROVEEDOR A", "PASIVO");

    await mkAsiento([
      { cuentaId: banco, debe: "10000.00" },
      { cuentaId: cliente, haber: "10000.00" },
    ]);
    await mkAsiento([
      { cuentaId: proveedor, debe: "4000.00" },
      { cuentaId: banco, haber: "4000.00" },
    ]);

    const flujo = await getFlujoCaja(DESDE, HASTA, "ARS");
    expect(ultimoSaldo(flujo)).toBeCloseTo(6000, 2);
    expect(ultimoSaldo(flujo)).toBeCloseTo(await ancla(banco, "ARS"), 2);
    expect(flujo.advertencias).toHaveLength(0);
  });

  it("2) invariante USD con metadata; el banco USD no aparece en el reporte ARS", async () => {
    const bancoUsd = await mkBanco("1.1.2.02", "BANCO USD", "USD");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE USD", "ACTIVO");

    // Cobro 1000 USD × TC 1000 → 1.000.000 ARS, metadata USD en ambas líneas.
    await mkAsiento([
      {
        cuentaId: bancoUsd,
        debe: "1000000.00",
        monedaOrigen: "USD",
        montoOrigen: "1000.00",
        tipoCambioOrigen: "1000",
      },
      {
        cuentaId: cliente,
        haber: "1000000.00",
        monedaOrigen: "USD",
        montoOrigen: "1000.00",
        tipoCambioOrigen: "1000",
      },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    expect(ultimoSaldo(usd)).toBeCloseTo(1000, 2);
    expect(ultimoSaldo(usd)).toBeCloseTo(await ancla(bancoUsd, "USD"), 2);

    // El reporte ARS no incluye una cuenta USD: no hay cuentas ARS.
    const ars = await getFlujoCaja(DESDE, HASTA, "ARS");
    expect(ultimoSaldo(ars)).toBeCloseTo(0, 2);
    expect(ars.contrapartidas).toHaveLength(0);
  });

  it("3) pago exterior (banco ARS / pasivo USD): aparece en ARS, no en USD", async () => {
    const bancoArs = await mkBanco("1.1.2.01", "BANCO NACION ARS", "ARS");
    await mkBanco("1.1.2.02", "BANCO USD", "USD"); // existe pero sin movimiento
    const proveedorExt = await mkCuenta("2.1.1.20", "PROVEEDOR EXTERIOR", "PASIVO");

    // Pago 500 USD × TC 1000 = 500.000 ARS desde el banco ARS.
    await mkAsiento([
      {
        cuentaId: proveedorExt,
        debe: "500000.00",
        monedaOrigen: "USD",
        montoOrigen: "500.00",
        tipoCambioOrigen: "1000",
      },
      { cuentaId: bancoArs, haber: "500000.00" },
    ]);

    const ars = await getFlujoCaja(DESDE, HASTA, "ARS");
    expect(ultimoSaldo(ars)).toBeCloseTo(-500000, 2);
    expect(ultimoSaldo(ars)).toBeCloseTo(await ancla(bancoArs, "ARS"), 2);
    expect(ars.advertencias).toHaveLength(0);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    expect(ultimoSaldo(usd)).toBeCloseTo(0, 2);
    // El pasivo USD NO aparece como flujo USD (ningún banco USD se movió).
    expect(usd.contrapartidas).toHaveLength(0);
  });

  it("4) misto inverso (banco USD / contrapartida ARS pura): saldo por lado banco + advertencia", async () => {
    const bancoUsd = await mkBanco("1.1.2.02", "BANCO USD", "USD");
    const gasto = await mkCuenta("5.2.1.01", "COMISIONES", "EGRESO");

    // Banco USD paga un gasto que es concepto ARS puro (sin metadata).
    await mkAsiento([
      { cuentaId: gasto, debe: "200000.00" },
      {
        cuentaId: bancoUsd,
        haber: "200000.00",
        monedaOrigen: "USD",
        montoOrigen: "200.00",
        tipoCambioOrigen: "1000",
      },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    // Saldo por el LADO BANCO: −200 USD (si viniera del lado contrapartida sería 0).
    expect(ultimoSaldo(usd)).toBeCloseTo(-200, 2);
    expect(ultimoSaldo(usd)).toBeCloseTo(await ancla(bancoUsd, "USD"), 2);
    // El gasto ARS no genera flujo USD → descuadre detectado.
    expect(usd.advertencias.length).toBeGreaterThanOrEqual(1);
    expect(usd.contrapartidas).toHaveLength(0);
  });

  it("5) transferencia cross-moeda ARS↔USD: cada reporte ve su pierna", async () => {
    const bancoArs = await mkBanco("1.1.2.01", "BANCO NACION ARS", "ARS");
    const bancoUsd = await mkBanco("1.1.2.02", "BANCO USD", "USD");

    // Compra de dólares: salen 100.000 ARS, entran 100 USD.
    await mkAsiento([
      {
        cuentaId: bancoUsd,
        debe: "100000.00",
        monedaOrigen: "USD",
        montoOrigen: "100.00",
        tipoCambioOrigen: "1000",
      },
      { cuentaId: bancoArs, haber: "100000.00" },
    ]);

    const ars = await getFlujoCaja(DESDE, HASTA, "ARS");
    expect(ultimoSaldo(ars)).toBeCloseTo(-100000, 2);
    expect(ultimoSaldo(ars)).toBeCloseTo(await ancla(bancoArs, "ARS"), 2);
    expect(ars.transferencias.length).toBeGreaterThanOrEqual(1);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    expect(ultimoSaldo(usd)).toBeCloseTo(100, 2);
    expect(ultimoSaldo(usd)).toBeCloseTo(await ancla(bancoUsd, "USD"), 2);
    expect(usd.transferencias.length).toBeGreaterThanOrEqual(1);
  });

  it("6) fallback legado USD (asiento.moneda=USD, debe/haber en USD crudo)", async () => {
    const bancoUsd = await mkBanco("1.1.2.02", "BANCO USD", "USD");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE USD", "ACTIVO");

    await mkAsiento(
      [
        { cuentaId: bancoUsd, debe: "200.00" },
        { cuentaId: cliente, haber: "200.00" },
      ],
      { moneda: "USD", tipoCambio: "950" },
    );

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    expect(ultimoSaldo(usd)).toBeCloseTo(200, 2);
    expect(ultimoSaldo(usd)).toBeCloseTo(await ancla(bancoUsd, "USD"), 2);
  });

  it("7) partición usa CuentaBancaria.moneda, no el nombre ni CuentaContable.moneda", async () => {
    // CuentaContable sin `moneda` (null) y nombre SIN 'DÓLAR', pero CuentaBancaria=USD.
    const banco = await mkBanco("1.1.2.05", "BANCO INTERNACIONAL", "USD");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE USD", "ACTIVO");

    await mkAsiento([
      {
        cuentaId: banco,
        debe: "300000.00",
        monedaOrigen: "USD",
        montoOrigen: "300.00",
        tipoCambioOrigen: "1000",
      },
      {
        cuentaId: cliente,
        haber: "300000.00",
        monedaOrigen: "USD",
        montoOrigen: "300.00",
        tipoCambioOrigen: "1000",
      },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    // Si particionara por nombre/CuentaContable.moneda, este banco caería en ARS
    // y el saldo USD sería 0.
    expect(ultimoSaldo(usd)).toBeCloseTo(300, 2);
    expect(ultimoSaldo(usd)).toBeCloseTo(await ancla(banco, "USD"), 2);
  });
});
