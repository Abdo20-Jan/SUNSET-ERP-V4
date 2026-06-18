import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// E4b — Fase 2 (diferencia cambiaria realizada) en pago VÍA INTERMEDIARIO.
//
// pagarConIntermediarioAction registra una transferencia única al
// despachante/agente que paga N facturas de proveedor en nuestro nombre.
// Hasta ahora cada factura se cancelaba al TC del pago, SIN reconocer la
// diferencia vs el TC de la factura. Ahora cada factura USD con saldo
// pendiente se debita al TC factura (FIFO ponderado, igual que E4a) y el
// spread neto se asienta en 9.2.01 (ganancia) / 9.2.02 (pérdida). El
// beneficiario (anticipo / saldo pendiente) NO lleva Fase 2: es creación de
// saldo, se valúa al TC del pago. El banco cierra por el desembolso real
// (montoTransferido × TC).

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
import { pagarConIntermediarioAction } from "@/lib/actions/movimientos-tesoreria";
import { secureRandomInt } from "@/lib/secure-random";

interface Seed {
  cuentaBancariaUsdId: string;
  cuentaBancariaArsId: string;
  cuentaBancoUsdContableId: number;
  cuentaBancoArsContableId: number;
  cuentaProveedorAId: number;
  cuentaProveedorBId: number;
  cuentaGastoId: number;
  cuentaBeneficiarioId: number;
  proveedorId: string;
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

  const bancoUsd = await mkCuenta("1.1.2.02", "BANCO USD", "ACTIVO");
  const bancoArs = await mkCuenta("1.1.2.01", "BANCO ARS", "ACTIVO");
  const provA = await mkCuenta("2.1.1.10", "PROVEEDOR A USD", "PASIVO");
  const provB = await mkCuenta("2.1.1.11", "PROVEEDOR B USD", "PASIVO");
  const gasto = await mkCuenta("5.2.1.01", "COMISIONES BANCARIAS", "EGRESO");
  const beneficiario = await mkCuenta("2.1.1.20", "DESPACHANTE INTERMEDIARIO", "PASIVO");

  // Sintéticas padre para auto-create de la diferencia (ULTRA clase 9).
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

  const cuentaBancariaUsd = await prisma.cuentaBancaria.create({
    data: {
      banco: "Test Bank USD",
      tipo: "CUENTA_CORRIENTE",
      moneda: Moneda.USD,
      numero: "0001-0001",
      cuentaContableId: bancoUsd.id,
    },
  });
  const cuentaBancariaArs = await prisma.cuentaBancaria.create({
    data: {
      banco: "Test Bank ARS",
      tipo: "CUENTA_CORRIENTE",
      moneda: Moneda.ARS,
      numero: "0002-0002",
      cuentaContableId: bancoArs.id,
    },
  });

  const proveedor = await prisma.proveedor.create({
    data: { nombre: "Proveedor Test" },
  });

  return {
    cuentaBancariaUsdId: cuentaBancariaUsd.id,
    cuentaBancariaArsId: cuentaBancariaArs.id,
    cuentaBancoUsdContableId: bancoUsd.id,
    cuentaBancoArsContableId: bancoArs.id,
    cuentaProveedorAId: provA.id,
    cuentaProveedorBId: provB.id,
    cuentaGastoId: gasto.id,
    cuentaBeneficiarioId: beneficiario.id,
    proveedorId: proveedor.id,
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
            cuentaId: s.cuentaBancoUsdContableId, // contrapartida cualquiera
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

describe("E4b — diferencia cambiaria en pago vía intermediario", () => {
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
      "Gasto",
      "Proveedor",
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

  it("pago exacto (diferencia=0): cada factura al TC factura, banco al TC pago, sin beneficiario", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorBId, 2000, 1100, new Date("2025-06-02"));

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      montoTransferido: "3000.00",
      facturas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProveedorBId, monto: "2000.00" },
      ],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tipoDiferencia).toBe("exacto");

    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: r.asientoId } });
    expect(asiento.moneda).toBe("ARS");
    expect(Number(asiento.tipoCambio)).toBe(1);

    const lineas = await lineasDe(r.asientoId);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    const provB = lineas.find((l) => l.cuentaId === s.cuentaProveedorBId);
    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoUsdContableId);
    const ganancia = lineas.find((l) => l.cuenta.codigo === "9.2.01");

    expect(Number(provA?.debe)).toBeCloseTo(1_200_000, 2); // TC factura
    expect(Number(provA?.tipoCambioOrigen)).toBeCloseTo(1200, 4);
    expect(Number(provB?.debe)).toBeCloseTo(2_200_000, 2);
    expect(Number(provB?.tipoCambioOrigen)).toBeCloseTo(1100, 4);
    expect(Number(banco?.haber)).toBeCloseTo(3_000_000, 2); // desembolso real
    expect(Number(ganancia?.haber)).toBeCloseTo(400_000, 2);
    // diferencia=0 → ninguna línea para el beneficiario.
    expect(lineas.some((l) => l.cuentaId === s.cuentaBeneficiarioId)).toBe(false);
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
    expect(Number(asiento.totalDebe)).toBeCloseTo(3_400_000, 2);
  });

  it("anticipo (diferencia>0): factura con Fase 2 + beneficiario DEBE al TC pago", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      montoTransferido: "1500.00", // 1000 facturas + 500 anticipo
      facturas: [{ cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" }],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tipoDiferencia).toBe("anticipo");

    const lineas = await lineasDe(r.asientoId);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    const benef = lineas.find((l) => l.cuentaId === s.cuentaBeneficiarioId);
    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoUsdContableId);
    const ganancia = lineas.find((l) => l.cuenta.codigo === "9.2.01");

    expect(Number(provA?.debe)).toBeCloseTo(1_200_000, 2); // TC factura
    expect(Number(benef?.debe)).toBeCloseTo(500_000, 2); // anticipo al TC pago
    expect(Number(benef?.tipoCambioOrigen)).toBeCloseTo(1000, 4); // SIN Fase 2
    expect(Number(banco?.haber)).toBeCloseTo(1_500_000, 2); // desembolso real
    expect(Number(ganancia?.haber)).toBeCloseTo(200_000, 2);

    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: r.asientoId } });
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
  });

  it("saldo pendiente (diferencia<0): factura con Fase 2 + beneficiario HABER al TC pago", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      montoTransferido: "800.00", // 1000 facturas − 200 que quedan a deber
      facturas: [{ cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" }],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tipoDiferencia).toBe("saldo_pendiente");

    const lineas = await lineasDe(r.asientoId);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    const benef = lineas.find((l) => l.cuentaId === s.cuentaBeneficiarioId);
    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoUsdContableId);
    const ganancia = lineas.find((l) => l.cuenta.codigo === "9.2.01");

    expect(Number(provA?.debe)).toBeCloseTo(1_200_000, 2); // TC factura
    expect(Number(benef?.haber)).toBeCloseTo(200_000, 2); // saldo pendiente al TC pago
    expect(Number(banco?.haber)).toBeCloseTo(800_000, 2); // desembolso real
    expect(Number(ganancia?.haber)).toBeCloseTo(200_000, 2);

    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: r.asientoId } });
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
  });

  it("dos facturas a la MISMA cuenta no consumen dos veces el FIFO", async () => {
    // Proveedor A con dos facturas (FIFO): F1 1000 @ 1200, F2 2000 @ 1100.
    // El intermediario las separa en dos líneas de factura a la misma cuenta.
    // Sin el corrimiento por cuenta (usdConsumidoPorCuenta), cada línea
    // re-leería el mismo saldo y consumiría F1 dos veces (debe total 3.5M).
    // Correcto: F1 + F2 = 1.2M + 2.2M = 3.4M.
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 2000, 1100, new Date("2025-06-02"));

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      montoTransferido: "3000.00",
      facturas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProveedorAId, monto: "2000.00" },
      ],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    const debeProvA = lineas
      .filter((l) => l.cuentaId === s.cuentaProveedorAId)
      .reduce((acc, l) => acc + Number(l.debe), 0);
    expect(debeProvA).toBeCloseTo(3_400_000, 2); // NO 3.500.000 (sin double-count)

    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoUsdContableId);
    const ganancia = lineas.find((l) => l.cuenta.codigo === "9.2.01");
    expect(Number(banco?.haber)).toBeCloseTo(3_000_000, 2);
    expect(Number(ganancia?.haber)).toBeCloseTo(400_000, 2); // (1.2M−1.0M)+(2.2M−2.0M)

    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: r.asientoId } });
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
  });

  it("netea ganancia contra pérdida en UNA sola línea de diferencia", async () => {
    // A: 1000 @ 1300; pago @ 1100 → +200.000 ganancia
    // B: 1000 @ 1000; pago @ 1100 → −100.000 pérdida
    // neto = +100.000 → una sola línea 9.2.01.
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1300, new Date("2025-06-01"));
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorBId, 1000, 1000, new Date("2025-06-02"));

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1100",
      montoTransferido: "2000.00",
      facturas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProveedorBId, monto: "1000.00" },
      ],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
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

  it("factura sin saldo USD (gasto) se debita a monto × TC, sin diferencia propia", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      montoTransferido: "1500.00",
      facturas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" }, // Fase 2
        { cuentaContableId: s.cuentaGastoId, monto: "500.00" }, // sin saldo USD
      ],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    const gasto = lineas.find((l) => l.cuentaId === s.cuentaGastoId);
    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoUsdContableId);
    const ganancia = lineas.find((l) => l.cuenta.codigo === "9.2.01");

    expect(Number(provA?.debe)).toBeCloseTo(1_200_000, 2); // TC factura
    expect(Number(gasto?.debe)).toBeCloseTo(500_000, 2); // monto × TC pago
    expect(Number(gasto?.tipoCambioOrigen)).toBeCloseTo(1000, 4);
    expect(Number(banco?.haber)).toBeCloseTo(1_500_000, 2);
    expect(Number(ganancia?.haber)).toBeCloseTo(200_000, 2); // solo del proveedor
  });

  it("sin saldo USD pendiente en ninguna factura: no genera diferencia (no-regresión)", async () => {
    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1000",
      montoTransferido: "3000.00",
      facturas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProveedorBId, monto: "2000.00" },
      ],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    expect(lineas).toHaveLength(3); // 2 facturas + banco (sin beneficiario, dif=0)
    expect(lineas.some((l) => l.cuenta.codigo.startsWith("9.2"))).toBe(false);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    expect(Number(provA?.debe)).toBeCloseTo(1_000_000, 2); // monto × TC pago
  });

  it("pago ARS con diferencia: nunca Fase 2, sin línea 9.2.x (no-regresión)", async () => {
    // Aunque la cuenta tuviera saldo, en ARS no aplica diferencia cambiaria.
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1200, new Date("2025-06-01"));

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaArsId,
      fecha: fechaPago,
      moneda: "ARS",
      tipoCambio: "1",
      montoTransferido: "1500.00",
      facturas: [{ cuentaContableId: s.cuentaProveedorAId, monto: "1000.00" }],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tipoDiferencia).toBe("anticipo");

    const lineas = await lineasDe(r.asientoId);
    expect(lineas.some((l) => l.cuenta.codigo.startsWith("9.2"))).toBe(false);
    const provA = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    const benef = lineas.find((l) => l.cuentaId === s.cuentaBeneficiarioId);
    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoArsContableId);
    expect(Number(provA?.debe)).toBeCloseTo(1000, 2); // monto crudo ARS
    expect(Number(benef?.debe)).toBeCloseTo(500, 2);
    expect(Number(banco?.haber)).toBeCloseTo(1500, 2);

    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: r.asientoId } });
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
  });

  it("rechaza pago parcial: una factura USD que excede el saldo pendiente", async () => {
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1000, new Date("2025-06-01"));

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1100",
      montoTransferido: "5000.00",
      facturas: [{ cuentaContableId: s.cuentaProveedorAId, monto: "5000.00" }], // saldo = 1000
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/excede el saldo/i);
  });

  it("appliedTo apunta a la factura aunque haya línea de diferencia-pérdida (DEBE)", async () => {
    // Factura A 1000 @ 1000; pago @ 1100 → pérdida 100.000 → línea 9.2.02 con
    // DEBE. gravarAplicacionesPago mapea las N primeras líneas DEBE (id asc) a
    // las facturas; la línea de pérdida se inserta al final (mayor id) y NO
    // debe capturar la aplicación.
    await lanzarFacturaUsd(db.prisma, s, s.cuentaProveedorAId, 1000, 1000, new Date("2025-06-01"));
    const gasto = await db.prisma.gasto.create({
      data: {
        numero: `G-${secureRandomInt(1_000_000)}`,
        proveedorId: s.proveedorId,
        fecha: new Date("2025-06-01"),
        subtotal: "1000000.00",
        total: "1000000.00",
        moneda: Moneda.USD,
        tipoCambio: "1000",
      },
    });

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: fechaPago,
      moneda: "USD",
      tipoCambio: "1100",
      montoTransferido: "1000.00",
      facturas: [
        {
          cuentaContableId: s.cuentaProveedorAId,
          monto: "1000.00",
          appliedTo: { tipo: "gasto", id: gasto.id, montoArs: "1000000.00" },
        },
      ],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    const lineaFactura = lineas.find((l) => l.cuentaId === s.cuentaProveedorAId);
    const lineaPerdida = lineas.find((l) => l.cuenta.codigo === "9.2.02");
    expect(Number(lineaFactura?.debe)).toBeCloseTo(1_000_000, 2); // TC factura
    expect(Number(lineaPerdida?.debe)).toBeCloseTo(100_000, 2); // pérdida

    const aplicacion = await db.prisma.aplicacionPagoGasto.findFirstOrThrow({
      where: { gastoId: gasto.id },
    });
    expect(aplicacion.lineaAsientoId).toBe(lineaFactura?.id);
    expect(aplicacion.lineaAsientoId).not.toBe(lineaPerdida?.id);

    const asiento = await db.prisma.asiento.findUniqueOrThrow({ where: { id: r.asientoId } });
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
  });
});
