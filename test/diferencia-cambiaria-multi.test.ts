import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "decimal.js";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// E4a — Fase 2 (diferencia cambiaria realizada) en pago MULTI-CONTRAPARTIDA.
//
// Hasta ahora la Fase 2 sólo disparaba en el pago de 1 contrapartida
// (crearAsientoMovimientoTesoreria). El camino multi-contrapartida de
// crearMovimientoTesoreriaAction (lineas.length > 1) cancelaba cada pasivo
// proveedor al TC del pago, SIN reconocer la diferencia vs el TC de la
// factura. Ahora cada pierna USD con saldo pendiente se debita al TC factura
// (FIFO ponderado) y el spread neto se asienta en 9.2.01 (ganancia) / 9.2.02
// (pérdida). El banco sigue cerrando por el desembolso real (Σ monto × TC).

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

import { AsientoEstado, AsientoOrigen, Moneda } from "@/generated/prisma/client";
import { crearMovimientoTesoreriaAction } from "@/lib/actions/movimientos-tesoreria";
import { calcularPernaPagoUsd } from "@/lib/services/asiento-automatico";
import { secureRandomInt } from "@/lib/secure-random";

interface Seed {
  cuentaBancariaUsdId: string;
  cuentaBancoContableId: number;
  cuentaProveedorAId: number;
  cuentaProveedorBId: number;
  cuentaGastoId: number;
  periodoId: number;
}

async function seed(prisma: PrismaClient): Promise<Seed> {
  const periodo = await prisma.periodoContable.create({
    data: {
      codigo: "2025-06",
      nombre: "Junio 2025",
      fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
      fechaFin: new Date("2025-06-30T23:59:59.000Z"),
      estado: "ABIERTO",
    },
  });

  const mkCuenta = (codigo: string, nombre: string, categoria: "ACTIVO" | "PASIVO" | "EGRESO") =>
    prisma.cuentaContable.create({
      data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4 },
    });

  const banco = await mkCuenta("1.1.2.02", "BANCO USD", "ACTIVO");
  const provA = await mkCuenta("2.1.1.10", "PROVEEDOR A USD", "PASIVO");
  const provB = await mkCuenta("2.1.1.11", "PROVEEDOR B USD", "PASIVO");
  const gasto = await mkCuenta("5.2.1.01", "COMISIONES BANCARIAS", "EGRESO");

  // Sintéticas padre para auto-create de la diferencia (ULTRA clase 9).
  // 9.2.01 ganancia / 9.2.02 pérdida cuelgan de 9.2 → 9.
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

  const cuentaBancaria = await prisma.cuentaBancaria.create({
    data: {
      banco: "Test Bank USD",
      tipo: "CUENTA_CORRIENTE",
      moneda: Moneda.USD,
      numero: "0001-0001",
      cuentaContableId: banco.id,
    },
  });

  return {
    cuentaBancariaUsdId: cuentaBancaria.id,
    cuentaBancoContableId: banco.id,
    cuentaProveedorAId: provA.id,
    cuentaProveedorBId: provB.id,
    cuentaGastoId: gasto.id,
    periodoId: periodo.id,
  };
}

/** Lanza una factura USD: asiento contabilizado con HABER USD-nato en la
 *  cuenta del proveedor (deja saldo pendiente al TC factura). */
async function lanzarFacturaUsd(
  prisma: PrismaClient,
  s: Seed,
  cuentaProveedorId: number,
  usd: number,
  tc: number,
  fecha: Date,
  descripcion = "Factura test",
) {
  const ars = (usd * tc).toFixed(2);
  return prisma.asiento.create({
    data: {
      numero: secureRandomInt(1_000_000),
      fecha,
      descripcion,
      estado: AsientoEstado.CONTABILIZADO,
      origen: AsientoOrigen.MANUAL,
      moneda: Moneda.ARS,
      tipoCambio: "1",
      totalDebe: ars,
      totalHaber: ars,
      periodoId: s.periodoId,
      lineas: {
        create: [
          {
            cuentaId: s.cuentaBancoContableId, // contrapartida cualquiera
            debe: ars,
            haber: 0,
            descripcion: "Activo factura",
          },
          {
            cuentaId: cuentaProveedorId,
            debe: 0,
            haber: ars,
            descripcion: `${descripcion} — pasivo proveedor`,
            monedaOrigen: Moneda.USD,
            montoOrigen: usd.toFixed(2),
            tipoCambioOrigen: tc.toFixed(6),
          },
        ],
      },
    },
  });
}

const fechaPago = new Date("2025-06-20T12:00:00.000Z");

describe("E4a — diferencia cambiaria en pago multi-contrapartida", () => {
  let db: TestDb;
  let s: Seed;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.reset([
      "AplicacionPagoEmbarqueCosto",
      "AplicacionPagoCompra",
      "AplicacionPagoGasto",
      "MovimientoTesoreria",
      "LineaAsiento",
      "Asiento",
      "CuentaBancaria",
      "PeriodoContable",
      "CuentaContable",
    ]);
    s = await seed(db.prisma);
  });

  async function lineasDe(asientoId: string) {
    return db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true } } },
      orderBy: { id: "asc" },
    });
  }

  it("ganancia neta: cada pierna USD se debita al TC factura, banco al TC pago", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorBId, 2000, 1100, new Date("2025-06-02"));

    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProveedorBId, monto: "2000.00" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const asiento = await db.prisma.asiento.findUniqueOrThrow({
      where: { id: r.asientoId },
      include: { lineas: true },
    });
    expect(asiento.moneda).toBe("ARS");
    expect(Number(asiento.tipoCambio)).toBe(1);

    const lineas = await lineasDe(r.asientoId);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    const provB = lineas.find((l) => l.cuentaId === s.cuentaProveedorBId);
    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoContableId);
    const ganancia = lineas.find((l) => l.cuenta.codigo === "9.2.01");

    // Pierna proveedor: DEBE = USD × TC_factura.
    expect(Number(provA?.debe)).toBeCloseTo(1_200_000, 2);
    expect(Number(provA?.tipoCambioOrigen)).toBeCloseTo(1200, 4);
    expect(Number(provB?.debe)).toBeCloseTo(2_200_000, 2);
    expect(Number(provB?.tipoCambioOrigen)).toBeCloseTo(1100, 4);
    // Banco: HABER = desembolso real Σ(USD × TC_pago) = 3.000.000.
    expect(Number(banco?.haber)).toBeCloseTo(3_000_000, 2);
    // Diferencia neta: (1.2M − 1.0M) + (2.2M − 2.0M) = 400.000 ganancia.
    expect(ganancia).toBeDefined();
    expect(Number(ganancia?.haber)).toBeCloseTo(400_000, 2);
    expect(lineas.some((l) => l.cuenta.codigo === "9.2.02")).toBe(false);
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
    expect(Number(asiento.totalDebe)).toBeCloseTo(3_400_000, 2);
  });

  it("dos piernas a la MISMA cuenta no consumen dos veces el FIFO", async () => {
    // Proveedor A con dos facturas (FIFO): F1 1000 @ 1200, F2 2000 @ 1100.
    // El pago las separa en dos piernas a la misma cuenta. Sin el corrimiento
    // por cuenta, cada pierna re-leería el mismo saldo y consumiría F1 dos
    // veces (debe total 3.5M). Correcto: F1 + F2 = 1.2M + 2.2M = 3.4M.
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 2000, 1100, new Date("2025-06-02"));

    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProveedorAId, monto: "2000.00" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    const debeProvA = lineas
      .filter((l) => l.cuentaId === s.cuentaProveedorAId)
      .reduce((acc, l) => acc + Number(l.debe), 0);
    expect(debeProvA).toBeCloseTo(3_400_000, 2); // NO 3.500.000 (sin double-count)

    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoContableId);
    const ganancia = lineas.find((l) => l.cuenta.codigo === "9.2.01");
    expect(Number(banco?.haber)).toBeCloseTo(3_000_000, 2);
    expect(Number(ganancia?.haber)).toBeCloseTo(400_000, 2); // (1.2M−1.0M)+(2.2M−2.0M)

    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: r.asientoId } });
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
  });

  it("netea ganancia contra pérdida en UNA sola línea de diferencia", async () => {
    // A: 1000 @ 1300 (factura); pago @ 1100 → +200.000 ganancia
    // B: 1000 @ 1000 (factura); pago @ 1100 → −100.000 pérdida
    // neto = +100.000 → una sola línea 9.2.01.
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1300, new Date("2025-06-01"));
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorBId, 1000, 1000, new Date("2025-06-02"));

    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1100",
      lineas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProveedorBId, monto: "1000.00" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    const difLineas = lineas.filter(
      (l) => l.cuenta.codigo === "9.2.01" || l.cuenta.codigo === "9.2.02",
    );
    expect(difLineas).toHaveLength(1);
    expect(difLineas[0]?.cuenta.codigo).toBe("9.2.01");
    expect(Number(difLineas[0]?.haber)).toBeCloseTo(100_000, 2);

    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: r.asientoId } });
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
  });

  it("pierna sin saldo USD pendiente (gasto) se debita a monto × TC, sin diferencia propia", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));

    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" }, // Fase 2
        { cuentaContableId: s.cuentaGastoId, monto: "500.00" }, // sin saldo USD
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    const gasto = lineas.find((l) => l.cuentaId === s.cuentaGastoId);
    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoContableId);
    const ganancia = lineas.find((l) => l.cuenta.codigo === "9.2.01");

    expect(Number(provA?.debe)).toBeCloseTo(1_200_000, 2); // TC factura
    expect(Number(gasto?.debe)).toBeCloseTo(500_000, 2); // monto × TC pago
    expect(Number(gasto?.tipoCambioOrigen)).toBeCloseTo(1000, 4);
    expect(Number(banco?.haber)).toBeCloseTo(1_500_000, 2);
    // Diferencia sólo del proveedor: 1.2M − 1.0M = 200.000.
    expect(Number(ganancia?.haber)).toBeCloseTo(200_000, 2);
  });

  it("sin saldo USD pendiente en ninguna pierna: no genera diferencia (no-regresión)", async () => {
    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProveedorBId, monto: "2000.00" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    expect(lineas).toHaveLength(3); // 2 proveedores + banco
    expect(lineas.some((l) => l.cuenta.codigo.startsWith("9.2"))).toBe(false);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    expect(Number(provA?.debe)).toBeCloseTo(1_000_000, 2); // monto × TC pago
  });

  it("rechaza pago parcial: una pierna USD que excede el saldo pendiente", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1000, new Date("2025-06-01"));
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorBId, 2000, 1000, new Date("2025-06-02"));

    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1100",
      lineas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "5000.00" }, // saldo = 1000
        { cuentaContableId: s.cuentaProveedorBId, monto: "2000.00" },
      ],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/excede el saldo/i);
  });

  it("helper calcularPernaPagoUsd: sin saldo → no Fase 2; saldo exacto → Fase 2", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));

    const conSaldo = await calcularPernaPagoUsd(
      db.prisma as never,
      s.cuentaProveedorAId,
      new Decimal(1000),
      new Decimal(1000),
    );
    expect(conSaldo.esFase2).toBe(true);
    expect(conSaldo.debeArs.toNumber()).toBeCloseTo(1_200_000, 2); // TC factura
    expect(conSaldo.spread.toNumber()).toBeCloseTo(200_000, 2); // 1.2M − 1.0M

    const sinSaldo = await calcularPernaPagoUsd(
      db.prisma as never,
      s.cuentaProveedorBId,
      new Decimal(500),
      new Decimal(1000),
    );
    expect(sinSaldo.esFase2).toBe(false);
    expect(sinSaldo.debeArs.toNumber()).toBeCloseTo(500_000, 2); // monto × TC
    expect(sinSaldo.spread.toNumber()).toBe(0);
  });
});
