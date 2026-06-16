import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// E3 (PE.4) — Libro diario ARS-único en tesorería.
//
// Bug original (auditoría 2026-06, hallazgo nº1): COBRO/PAGO/TRANSFERENCIA
// con movimiento USD grababan debe/haber en USD crudo con asiento.moneda=USD,
// mezclando monedas en el ledger. Regla nueva: todo asiento se registra en
// pesos (moneda=ARS, tipoCambio=1); el debe/haber USD se convierte por el TC
// del movimiento y el principal USD queda en la metadata de cada línea
// (monedaOrigen/montoOrigen/tipoCambioOrigen). El motor rechaza cualquier
// asiento nuevo con moneda ≠ ARS (MONEDA_INVALIDA).

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

import { aprobarLineaAction } from "@/lib/actions/extractos";
import {
  crearMovimientoTesoreriaAction,
  pagarConIntermediarioAction,
} from "@/lib/actions/movimientos-tesoreria";
import {
  AsientoError,
  crearAsientoManual,
  crearAsientoTransferencia,
} from "@/lib/services/asiento-automatico";
import { calcularSaldosCuentasBancariasEnMonedaCuenta } from "@/lib/services/cuenta-bancaria";

interface Seed {
  cuentaBancariaId: string;
  cuentaBancoContableId: number;
  cuentaGastoId: number;
  cuentaImpuestoId: number;
  cuentaProveedorAId: number;
  cuentaProveedorBId: number;
  importacionId: string;
  periodoId: number;
}

describe("E3 — tesorería USD graba el libro en ARS", () => {
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
    await db.reset([
      "LineaExtractoSugerencia",
      "ImportacionExtracto",
      "AplicacionPagoEmbarqueCosto",
      "AplicacionPagoCompra",
      "AplicacionPagoGasto",
      "MovimientoTesoreria",
      "LineaAsiento",
      "Asiento",
      "Cotizacion",
      "CuentaBancaria",
      "PeriodoContable",
      "CuentaContable",
    ]);
  });

  async function seed(moneda: "ARS" | "USD"): Promise<Seed> {
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });

    const mkCuenta = (codigo: string, nombre: string, categoria: "ACTIVO" | "PASIVO" | "EGRESO") =>
      db.prisma.cuentaContable.create({
        data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4 },
      });

    const cuentaBanco = await mkCuenta(
      moneda === "ARS" ? "1.1.2.01" : "1.1.2.02",
      `BANCO SANTANDER ${moneda}`,
      "ACTIVO",
    );
    const cuentaGasto = await mkCuenta("5.2.1.01", "COMISIONES BANCARIAS", "EGRESO");
    const cuentaImpuesto = await mkCuenta("5.8.1.05", "IMPUESTO LEY 25413", "EGRESO");
    const cuentaProveedorA = await mkCuenta("2.1.1.10", "PROVEEDOR A", "PASIVO");
    const cuentaProveedorB = await mkCuenta("2.1.1.11", "PROVEEDOR B", "PASIVO");

    const cuentaBancaria = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Santander",
        tipo: "CUENTA_CORRIENTE",
        moneda,
        numero: "0001-0001",
        cuentaContableId: cuentaBanco.id,
      },
    });

    const importacion = await db.prisma.importacionExtracto.create({
      data: {
        cuentaBancariaId: cuentaBancaria.id,
        periodoYear: 2025,
        periodoMonth: 6,
        saldoInicial: "0.00",
        saldoFinal: "0.00",
        totalLineas: 1,
      },
    });

    return {
      cuentaBancariaId: cuentaBancaria.id,
      cuentaBancoContableId: cuentaBanco.id,
      cuentaGastoId: cuentaGasto.id,
      cuentaImpuestoId: cuentaImpuesto.id,
      cuentaProveedorAId: cuentaProveedorA.id,
      cuentaProveedorBId: cuentaProveedorB.id,
      importacionId: importacion.id,
      periodoId: periodo.id,
    };
  }

  async function crearLineaExtracto(
    s: Seed,
    opts: { monto: string; cuentaSugeridaId: number },
  ): Promise<{ id: string }> {
    return db.prisma.lineaExtractoSugerencia.create({
      data: {
        importacionId: s.importacionId,
        ordenLinea: 1,
        fecha: new Date("2025-06-10T12:00:00.000Z"),
        descripcion: "LINEA EXTRACTO",
        monto: opts.monto,
        cuentaSugeridaId: opts.cuentaSugeridaId,
      },
      select: { id: true },
    });
  }

  it("Ley 25413 en cuenta USD: split 33/67 sobre el valor en ARS, banco con metadata USD", async () => {
    const s = await seed("USD");
    const linea = await crearLineaExtracto(s, {
      monto: "-100.00",
      cuentaSugeridaId: s.cuentaImpuestoId,
    });

    const r = await aprobarLineaAction(linea.id, { tipoCambio: 1000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: r.movimientoId },
      include: { asiento: { include: { lineas: { include: { cuenta: true } } } } },
    });
    expect(mov.asiento?.moneda).toBe("ARS");
    expect(Number(mov.asiento?.tipoCambio)).toBe(1);

    const lineas = mov.asiento?.lineas ?? [];
    expect(lineas).toHaveLength(3);

    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoContableId);
    const gasto = lineas.find((l) => l.cuentaId === s.cuentaImpuestoId);
    const credito = lineas.find((l) => l.cuenta.codigo === "1.1.5.3.02");

    // 100 USD × TC 1000 = 100.000 ARS → crédito 33.000, gasto 67.000.
    expect(Number(banco?.haber)).toBeCloseTo(100_000, 2);
    expect(Number(credito?.debe)).toBeCloseTo(33_000, 2);
    expect(Number(gasto?.debe)).toBeCloseTo(67_000, 2);
    // Principal USD sólo en la línea del banco (las parcelas del impuesto
    // son conceptos ARS).
    expect(banco?.monedaOrigen).toBe("USD");
    expect(Number(banco?.montoOrigen)).toBeCloseTo(100, 2);
    expect(gasto?.monedaOrigen).toBeNull();
    expect(credito?.monedaOrigen).toBeNull();
  });

  it("Ley 25413 en cuenta ARS sigue idéntico tras unificar el path en el motor", async () => {
    const s = await seed("ARS");
    const linea = await crearLineaExtracto(s, {
      monto: "-100.00",
      cuentaSugeridaId: s.cuentaImpuestoId,
    });

    const r = await aprobarLineaAction(linea.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: r.movimientoId },
      include: { asiento: { include: { lineas: { include: { cuenta: true } } } } },
    });
    const lineas = mov.asiento?.lineas ?? [];
    expect(lineas).toHaveLength(3);
    expect(Number(lineas.find((l) => l.cuentaId === s.cuentaBancoContableId)?.haber)).toBeCloseTo(
      100,
      2,
    );
    expect(Number(lineas.find((l) => l.cuenta.codigo === "1.1.5.3.02")?.debe)).toBeCloseTo(33, 2);
    expect(Number(lineas.find((l) => l.cuentaId === s.cuentaImpuestoId)?.debe)).toBeCloseTo(67, 2);
    expect(mov.asiento?.moneda).toBe("ARS");
  });

  it("el motor rechaza asientos nuevos con moneda ≠ ARS (MONEDA_INVALIDA)", async () => {
    const s = await seed("ARS");
    await expect(
      crearAsientoManual({
        fecha: new Date("2025-06-10T12:00:00.000Z"),
        descripcion: "asiento USD prohibido",
        origen: "MANUAL",
        moneda: "USD",
        tipoCambio: "1200",
        lineas: [
          { cuentaId: s.cuentaBancoContableId, debe: "100.00", haber: 0 },
          { cuentaId: s.cuentaGastoId, debe: 0, haber: "100.00" },
        ],
      }),
    ).rejects.toMatchObject({ code: "MONEDA_INVALIDA" });

    // ARS con TC ≠ 1 también es inválido: el libro es en pesos.
    await expect(
      crearAsientoManual({
        fecha: new Date("2025-06-10T12:00:00.000Z"),
        descripcion: "ARS con TC raro",
        origen: "MANUAL",
        moneda: "ARS",
        tipoCambio: "2",
        lineas: [
          { cuentaId: s.cuentaBancoContableId, debe: "100.00", haber: 0 },
          { cuentaId: s.cuentaGastoId, debe: 0, haber: "100.00" },
        ],
      }),
    ).rejects.toBeInstanceOf(AsientoError);
  });

  it("PAGO USD multi-contrapartida: líneas en ARS con metadata, banco cierra por suma exacta", async () => {
    const s = await seed("USD");

    // 0.33 × 1000.50 = 330.165 → 330.17 por parcela; banco = 660.34 (suma de
    // parcelas), distinto de total × TC = 660.33 — la partida cierra igual.
    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: new Date("2025-06-10T12:00:00.000Z"),
      moneda: "USD",
      tipoCambio: "1000.50",
      lineas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "0.33" },
        { cuentaContableId: s.cuentaProveedorBId, monto: "0.33" },
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
    expect(Number(asiento.totalDebe)).toBeCloseTo(660.34, 2);
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);

    const banco = asiento.lineas.find((l) => l.cuentaId === s.cuentaBancoContableId);
    expect(Number(banco?.haber)).toBeCloseTo(660.34, 2);
    expect(banco?.monedaOrigen).toBe("USD");
    expect(Number(banco?.montoOrigen)).toBeCloseTo(0.66, 2);

    for (const cuentaId of [s.cuentaProveedorAId, s.cuentaProveedorBId]) {
      const l = asiento.lineas.find((x) => x.cuentaId === cuentaId);
      expect(Number(l?.debe)).toBeCloseTo(330.17, 2);
      expect(l?.monedaOrigen).toBe("USD");
      expect(Number(l?.montoOrigen)).toBeCloseTo(0.33, 2);
      expect(Number(l?.tipoCambioOrigen)).toBeCloseTo(1000.5, 4);
    }
  });

  it("pago vía intermediario USD: facturas y anticipo en ARS, asiento ARS/1", async () => {
    const s = await seed("USD");

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: new Date("2025-06-10T12:00:00.000Z"),
      moneda: "USD",
      tipoCambio: "1000",
      montoTransferido: "1000.00",
      facturas: [
        { cuentaContableId: s.cuentaProveedorAId, monto: "600.00" },
        { cuentaContableId: s.cuentaProveedorBId, monto: "300.00" },
      ],
      beneficiarioCuentaId: s.cuentaGastoId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const asiento = await db.prisma.asiento.findUniqueOrThrow({
      where: { id: r.asientoId },
      include: { lineas: true },
    });
    expect(asiento.moneda).toBe("ARS");
    expect(Number(asiento.tipoCambio)).toBe(1);

    const banco = asiento.lineas.find((l) => l.cuentaId === s.cuentaBancoContableId);
    const anticipo = asiento.lineas.find((l) => l.cuentaId === s.cuentaGastoId);
    expect(Number(banco?.haber)).toBeCloseTo(1_000_000, 2);
    expect(Number(banco?.montoOrigen)).toBeCloseTo(1000, 2);
    expect(
      Number(asiento.lineas.find((l) => l.cuentaId === s.cuentaProveedorAId)?.debe),
    ).toBeCloseTo(600_000, 2);
    expect(Number(anticipo?.debe)).toBeCloseTo(100_000, 2);
    expect(anticipo?.monedaOrigen).toBe("USD");
    expect(Number(anticipo?.montoOrigen)).toBeCloseTo(100, 2);
    expect(Number(asiento.totalDebe)).toBeCloseTo(Number(asiento.totalHaber), 2);
  });

  it("saldo de cuenta USD en su moneda: metadata nueva + asientos legados USD crudo", async () => {
    const s = await seed("USD");

    // Asiento NUEVO vía extracto: COBRO 1500 USD × TC 1000 (metadata USD).
    const linea = await crearLineaExtracto(s, {
      monto: "1500.00",
      cuentaSugeridaId: s.cuentaGastoId,
    });
    const r = await aprobarLineaAction(linea.id, { tipoCambio: 1000 });
    expect(r.ok).toBe(true);

    // Asiento LEGADO (pre-E3) directo en la base: moneda=USD, debe/haber en
    // USD crudo, sin metadata — como los datos históricos de producción.
    await db.prisma.asiento.create({
      data: {
        numero: 9_999,
        fecha: new Date("2025-06-05T12:00:00.000Z"),
        descripcion: "COBRO USD legado",
        estado: "CONTABILIZADO",
        origen: "TESORERIA",
        moneda: "USD",
        tipoCambio: "950",
        totalDebe: "200.00",
        totalHaber: "200.00",
        periodoId: s.periodoId,
        lineas: {
          create: [
            { cuentaId: s.cuentaBancoContableId, debe: "200.00", haber: "0" },
            { cuentaId: s.cuentaGastoId, debe: "0", haber: "200.00" },
          ],
        },
      },
    });

    const saldos = await calcularSaldosCuentasBancariasEnMonedaCuenta([
      { cuentaContableId: s.cuentaBancoContableId, moneda: "USD" },
    ]);
    // 1500 (metadata montoOrigen) + 200 (legado USD crudo) = 1700 USD.
    expect(saldos.get(s.cuentaBancoContableId)?.toNumber()).toBeCloseTo(1700, 2);
  });

  it("saldo de cuenta ARS sigue siendo debe − haber del ledger", async () => {
    const s = await seed("ARS");
    const linea = await crearLineaExtracto(s, {
      monto: "2500.00",
      cuentaSugeridaId: s.cuentaGastoId,
    });
    const r = await aprobarLineaAction(linea.id);
    expect(r.ok).toBe(true);

    const saldos = await calcularSaldosCuentasBancariasEnMonedaCuenta([
      { cuentaContableId: s.cuentaBancoContableId, moneda: "ARS" },
    ]);
    expect(saldos.get(s.cuentaBancoContableId)?.toNumber()).toBeCloseTo(2500, 2);
  });

  it("transferencia USD → ARS entre bancos: metadata USD en la pierna origen y saldo USD correcto", async () => {
    const s = await seed("USD");

    // Segundo banco, en ARS, como destino de la transferencia.
    const cuentaBancoDestino = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.2.03",
        nombre: "BANCO GALICIA ARS",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const bancoDestino = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Galicia",
        tipo: "CUENTA_CORRIENTE",
        moneda: "ARS",
        numero: "0002-0002",
        cuentaContableId: cuentaBancoDestino.id,
      },
    });

    // 100 USD × TC 1000 = 100.000 ARS salen; llegan 99.500 ARS (spread del
    // banco) → diferencia de cambio negativa 500.
    const { asiento } = await crearAsientoTransferencia({
      fecha: new Date("2025-06-10T12:00:00.000Z"),
      cuentaBancariaOrigenId: s.cuentaBancariaId,
      cuentaBancariaDestinoId: bancoDestino.id,
      montoOrigen: "100.00",
      montoDestino: "99500.00",
      tipoCambioOrigen: "1000",
      tipoCambioDestino: "1",
    });

    const full = await db.prisma.asiento.findUniqueOrThrow({
      where: { id: asiento.id },
      include: { lineas: true },
    });
    expect(full.moneda).toBe("ARS");
    expect(Number(full.tipoCambio)).toBe(1);

    const origenLinea = full.lineas.find((l) => l.cuentaId === s.cuentaBancoContableId);
    const destinoLinea = full.lineas.find((l) => l.cuentaId === cuentaBancoDestino.id);
    expect(Number(origenLinea?.haber)).toBeCloseTo(100_000, 2);
    expect(origenLinea?.monedaOrigen).toBe("USD");
    expect(Number(origenLinea?.montoOrigen)).toBeCloseTo(100, 2);
    expect(Number(origenLinea?.tipoCambioOrigen)).toBeCloseTo(1000, 4);
    // La pierna ARS no lleva metadata USD.
    expect(destinoLinea?.monedaOrigen).toBeNull();

    // El saldo USD de la cuenta origen refleja la salida vía montoOrigen.
    await db.prisma.asiento.update({
      where: { id: asiento.id },
      data: { estado: "CONTABILIZADO" },
    });
    const saldos = await calcularSaldosCuentasBancariasEnMonedaCuenta([
      { cuentaContableId: s.cuentaBancoContableId, moneda: "USD" },
    ]);
    expect(saldos.get(s.cuentaBancoContableId)?.toNumber()).toBeCloseTo(-100, 2);
  });
});
