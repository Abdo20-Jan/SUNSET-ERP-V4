import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Cobertura del flujo de pago a proveedor exterior USD desde cuenta ARS.
//
// Modelo simplificado (sin diferencia cambial en el momento del pago):
//   - Asiento de 2 líneas: DEBE cuentaProveedor / HABER cuentaBanco — mismo ARS.
//   - El input es UNO de los dos: tipoCambioBanco O montoArs; el otro se deriva.
//   - MovimientoTesoreria USD con tipoCambio aplicado (informativo).
//   - AplicacionPago* gravada para compra/embarqueCosto (no para embarqueFob).
//   - La línea DEBE lleva monedaOrigen=USD + montoOrigen + tipoCambioOrigen:
//     el principal USD pagado, invariante a TC. El saldo USD se descuenta
//     desde esa metadata (helper compartido con getSaldosExteriorPorProveedor),
//     con tokens en la descripción sólo como fallback legacy.

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

import { pagarFacturaExteriorAction } from "@/lib/actions/pago-exterior";

const FECHA_FACTURA = new Date("2025-06-15T12:00:00.000Z");
const FECHA_PAGO = new Date("2025-06-20T12:00:00.000Z");
const TC_FACTURA = "1398.500000"; // sólo informativo; no entra en el pago
const MONTO_USD = "22000.00";

interface SeedExterior {
  cuentaBancariaArsId: string;
  cuentaBancariaUsdId: string;
  proveedorExteriorId: string;
  proveedorLocalId: string;
  embarqueCostoExteriorId: number;
  compraExteriorId: string;
  embarqueExteriorCodigo: string;
  embarqueExteriorId: string;
  cuentaProveedorExteriorId: number;
  cuentaBancoArsId: number;
}

describe("pagarFacturaExteriorAction — pago USD desde ARS (asiento 2 líneas)", () => {
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
      "AplicacionPagoCompra",
      "AplicacionPagoEmbarqueCosto",
      "AplicacionPagoGasto",
      "MovimientoTesoreria",
      "LineaAsiento",
      "Asiento",
      "EmbarqueCostoLinea",
      "EmbarqueCosto",
      "ItemCompra",
      "Compra",
      "ItemEmbarque",
      "Embarque",
      "Producto",
      "Deposito",
      "CuentaBancaria",
      "Proveedor",
      "PeriodoContable",
      "CuentaContable",
    ]);
  });

  async function seed(): Promise<SeedExterior> {
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });

    const cuentaBancoArs = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.2.01",
        nombre: "BANCO SANTANDER ARS",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const cuentaBancoUsd = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.2.02",
        nombre: "BANCO TEST USD",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const cuentaProvExterior = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.99.EXT",
        nombre: "SUNSET PARAGUAY",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 5,
      },
    });
    const cuentaProvLocal = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.99.LOC",
        nombre: "PROVEEDOR LOCAL",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 5,
      },
    });
    const cuentaGastoImp = await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.2.1.01",
        nombre: "GASTO IMPORTACIÓN",
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
      },
    });

    const cuentaBancariaArs = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Santander",
        tipo: "CUENTA_CORRIENTE",
        moneda: "ARS",
        numero: "0001-0001",
        cuentaContableId: cuentaBancoArs.id,
      },
    });
    const cuentaBancariaUsd = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Test USD",
        tipo: "CUENTA_CORRIENTE",
        moneda: "USD",
        numero: "0002-0002",
        cuentaContableId: cuentaBancoUsd.id,
      },
    });

    const proveedorExterior = await db.prisma.proveedor.create({
      data: {
        nombre: "SUNSET PARAGUAY",
        tipoProveedor: "MERCADERIA_EXTERIOR",
        pais: "PY",
        cuentaContableId: cuentaProvExterior.id,
      },
    });
    const proveedorLocal = await db.prisma.proveedor.create({
      data: {
        nombre: "PROVEEDOR LOCAL SRL",
        tipoProveedor: "MERCADERIA_LOCAL",
        pais: "AR",
        cuentaContableId: cuentaProvLocal.id,
      },
    });

    const producto = await db.prisma.producto.create({
      data: { codigo: "SKU-EXT", nombre: "Neumático EXT" },
    });
    const depDestino = await db.prisma.deposito.create({
      data: { nombre: "Nacional", tipo: "NACIONAL" },
    });

    const embarqueExterior = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-036CN",
        proveedorId: proveedorExterior.id,
        moneda: "USD",
        tipoCambio: TC_FACTURA,
        depositoDestinoId: depDestino.id,
        estado: "EN_DEPOSITO",
      },
    });
    await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarqueExterior.id,
        productoId: producto.id,
        cantidad: 100,
        precioUnitarioFob: "220.00",
      },
    });

    const embarqueCosto = await db.prisma.embarqueCosto.create({
      data: {
        embarqueId: embarqueExterior.id,
        proveedorId: proveedorExterior.id,
        moneda: "USD",
        tipoCambio: TC_FACTURA,
        facturaNumero: "INV-2025-036",
        fechaFactura: FECHA_FACTURA,
        momento: "ZONA_PRIMARIA",
        iva: "0",
        iibb: "0",
        otros: "0",
        estado: "EMITIDA",
        lineas: {
          create: [
            {
              tipo: "FLETE_INTERNACIONAL",
              cuentaContableGastoId: cuentaGastoImp.id,
              subtotal: MONTO_USD,
              descripcion: "Servicio importación",
            },
          ],
        },
      },
    });

    const compraExterior = await db.prisma.compra.create({
      data: {
        numero: "INV-FOB-2025-001",
        proveedorId: proveedorExterior.id,
        fecha: FECHA_FACTURA,
        moneda: "USD",
        tipoCambio: TC_FACTURA,
        subtotal: MONTO_USD,
        iva: "0",
        iibb: "0",
        otros: "0",
        total: MONTO_USD,
        estado: "EMITIDA",
      },
    });

    return {
      cuentaBancariaArsId: cuentaBancariaArs.id,
      cuentaBancariaUsdId: cuentaBancariaUsd.id,
      proveedorExteriorId: proveedorExterior.id,
      proveedorLocalId: proveedorLocal.id,
      embarqueCostoExteriorId: embarqueCosto.id,
      compraExteriorId: compraExterior.id,
      embarqueExteriorCodigo: embarqueExterior.codigo,
      embarqueExteriorId: embarqueExterior.id,
      cuentaProveedorExteriorId: cuentaProvExterior.id,
      cuentaBancoArsId: cuentaBancoArs.id,
    };
  }

  // Embarque sin Compra ni EmbarqueCosto USD del proveedor — flujo
  // Modelo Y bonded típico (deuda FOB sólo en items).
  async function seedEmbarqueFobOnly(
    proveedorExteriorId: string,
  ): Promise<{ embarqueId: string; embarqueCodigo: string }> {
    const producto = await db.prisma.producto.create({
      data: { codigo: "SKU-FOB", nombre: "Neumático FOB only" },
    });
    const dep = await db.prisma.deposito.findFirstOrThrow({ where: { nombre: "Nacional" } });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-FOB-ONLY",
        proveedorId: proveedorExteriorId,
        moneda: "USD",
        tipoCambio: TC_FACTURA,
        depositoDestinoId: dep.id,
        estado: "EN_ZONA_PRIMARIA",
      },
    });
    await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: producto.id,
        cantidad: 100,
        precioUnitarioFob: "220.00", // total FOB = 22.000 USD
      },
    });
    return { embarqueId: embarque.id, embarqueCodigo: embarque.codigo };
  }

  async function expectAsientoBalanceado(asientoId: string): Promise<void> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      select: { debe: true, haber: true },
    });
    let totalDebe = 0;
    let totalHaber = 0;
    for (const l of lineas) {
      totalDebe += Number(l.debe);
      totalHaber += Number(l.haber);
    }
    expect(Math.abs(totalDebe - totalHaber)).toBeLessThan(0.005);
  }

  // ============================================================
  // Casos principales — modo "tipoCambioBanco" (sistema calcula ARS)
  // ============================================================

  it("paga con TC dado — asiento 2 líneas, sin diferencia cambial", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    // USD 22.000 × 1.147,50 = ARS 25.245.000
    expect(Number(res.montoUsd)).toBeCloseTo(22000, 2);
    expect(Number(res.montoArs)).toBeCloseTo(25245000, 2);
    expect(Number(res.tipoCambioAplicado)).toBeCloseTo(1147.5, 6);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: res.asientoId },
      orderBy: { id: "asc" },
    });
    expect(lineas).toHaveLength(2); // sólo DEBE prov + HABER banco
    await expectAsientoBalanceado(res.asientoId);

    // DEBE cuentaProveedor = HABER banco = mismo monto
    expect(Number(lineas[0]!.debe)).toBeCloseTo(25245000, 2);
    expect(Number(lineas[0]!.haber)).toBeCloseTo(0, 2);
    expect(lineas[0]!.cuentaId).toBe(s.cuentaProveedorExteriorId);
    expect(Number(lineas[1]!.haber)).toBeCloseTo(25245000, 2);
    expect(lineas[1]!.cuentaId).toBe(s.cuentaBancoArsId);

    // Línea DEBE lleva el principal USD como metadata, invariante a TC.
    expect(lineas[0]!.monedaOrigen).toBe("USD");
    expect(Number(lineas[0]!.montoOrigen)).toBeCloseTo(22000, 2);
    expect(Number(lineas[0]!.tipoCambioOrigen)).toBeCloseTo(1147.5, 6);
    // La línea HABER del banco ARS no lleva metadata USD.
    expect(lineas[1]!.monedaOrigen).toBeNull();
    expect(lineas[1]!.montoOrigen).toBeNull();
  });

  // ============================================================
  // Casos principales — modo "montoArs" (sistema calcula TC)
  // ============================================================

  it("paga con montoArs dado — TC se deriva automáticamente", async () => {
    const s = await seed();
    // Pago ARS 25.000.000 por USD 22.000 → TC implícito 25M / 22k = 1136.363636
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      montoArs: "25000000.00",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    expect(Number(res.montoArs)).toBeCloseTo(25000000, 2);
    expect(Number(res.tipoCambioAplicado)).toBeCloseTo(1136.363636, 6);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: res.asientoId },
      orderBy: { id: "asc" },
    });
    expect(lineas).toHaveLength(2);
    expect(Number(lineas[0]!.debe)).toBeCloseTo(25000000, 2);
    expect(Number(lineas[1]!.haber)).toBeCloseTo(25000000, 2);

    // MovimientoTesoreria tem o TC derivado
    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: res.movimientoId },
    });
    expect(Number(mov.tipoCambio)).toBeCloseTo(1136.363636, 6);
  });

  // ============================================================
  // Validaciones del schema
  // ============================================================

  it("rechaza si NO se da tipoCambioBanco ni montoArs", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      fecha: FECHA_PAGO,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/tipo de cambio.*monto ARS|monto ARS.*tipo de cambio/i);
  });

  it("rechaza si se dan AMBOS tipoCambioBanco y montoArs", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      montoArs: "25245000.00",
      fecha: FECHA_PAGO,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/exactamente uno/i);
  });

  // ============================================================
  // Pago parcial — saldo restante consistente
  // ============================================================

  it("paga parcial — segundo pago aplica saldo restante", async () => {
    const s = await seed();

    const r1 = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
      montoUsdAPagar: "10000.00",
    });
    if (!r1.ok) throw new Error(`primer pago falló: ${r1.error}`);
    expect(Number(r1.montoUsd)).toBeCloseTo(10000, 2);
    expect(Number(r1.montoArs)).toBeCloseTo(11475000, 2);

    const r2 = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1200.000000", // TC distinto — sin generar 4.3.1.01
      fecha: FECHA_PAGO,
      montoUsdAPagar: "12000.00",
    });
    if (!r2.ok) throw new Error(`segundo pago falló: ${r2.error}`);
    expect(Number(r2.montoUsd)).toBeCloseTo(12000, 2);
    expect(Number(r2.montoArs)).toBeCloseTo(14400000, 2);

    // 3er intento rechazado (saldo zero).
    const r3 = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1200.000000",
      fecha: FECHA_PAGO,
      montoUsdAPagar: "1.00",
    });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toMatch(/no tiene saldo|excede/i);

    // 2 aplicaciones grabadas, cada una con montoArs distinto (no comparten TC).
    const aplicaciones = await db.prisma.aplicacionPagoEmbarqueCosto.findMany({
      where: { embarqueCostoId: s.embarqueCostoExteriorId },
      orderBy: { createdAt: "asc" },
    });
    expect(aplicaciones).toHaveLength(2);
    expect(Number(aplicaciones[0]!.montoArs)).toBeCloseTo(11475000, 2);
    expect(Number(aplicaciones[1]!.montoArs)).toBeCloseTo(14400000, 2);
  });

  // ============================================================
  // Compra USD (proveedor exterior con flujo Pedido→Compra)
  // ============================================================

  it("paga via Compra USD — registra AplicacionPagoCompra", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "compra",
      facturaId: s.compraExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    await expectAsientoBalanceado(res.asientoId);

    const aplicaciones = await db.prisma.aplicacionPagoCompra.findMany({
      where: { compraId: s.compraExteriorId },
    });
    expect(aplicaciones).toHaveLength(1);
    expect(Number(aplicaciones[0]!.montoArs)).toBeCloseTo(25245000, 2);
  });

  // ============================================================
  // Embarque FOB virtual (sin Compra ni EmbarqueCosto)
  // ============================================================

  it("paga via Embarque FOB virtual — asiento 2 líneas", async () => {
    const s = await seed();
    const fob = await seedEmbarqueFobOnly(s.proveedorExteriorId);

    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueFob",
      facturaId: fob.embarqueId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(Number(res.montoUsd)).toBeCloseTo(22000, 2);
    expect(Number(res.montoArs)).toBeCloseTo(25245000, 2);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: res.asientoId },
    });
    expect(lineas).toHaveLength(2);
    await expectAsientoBalanceado(res.asientoId);
  });

  // ============================================================
  // Comprobante + Referencia banco propagados
  // ============================================================

  it("propaga comprobante y referenciaBanco al MovimientoTesoreria", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
      comprobante: "OP-99887",
      referenciaBanco: "TRF-ABC-123",
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: res.movimientoId },
    });
    expect(mov.comprobante).toBe("OP-99887");
    expect(mov.referenciaBanco).toBe("TRF-ABC-123");
  });

  // ============================================================
  // Rechazos
  // ============================================================

  it("rechaza proveedor local (tipoProveedor MERCADERIA_LOCAL + pais AR)", async () => {
    const s = await seed();
    const cuentaGasto = await db.prisma.cuentaContable.findFirstOrThrow({
      where: { codigo: "5.2.1.01" },
    });
    const dep = await db.prisma.deposito.findFirstOrThrow({ where: { nombre: "Nacional" } });
    const embarqueLocal = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-LOCAL",
        proveedorId: s.proveedorLocalId,
        moneda: "USD",
        tipoCambio: TC_FACTURA,
        depositoDestinoId: dep.id,
        estado: "EN_DEPOSITO",
      },
    });
    const costoLocal = await db.prisma.embarqueCosto.create({
      data: {
        embarqueId: embarqueLocal.id,
        proveedorId: s.proveedorLocalId,
        moneda: "USD",
        tipoCambio: TC_FACTURA,
        facturaNumero: "INV-LOCAL-001",
        fechaFactura: FECHA_FACTURA,
        momento: "ZONA_PRIMARIA",
        iva: "0",
        iibb: "0",
        otros: "0",
        estado: "EMITIDA",
        lineas: {
          create: [
            {
              tipo: "FLETE_INTERNACIONAL",
              cuentaContableGastoId: cuentaGasto.id,
              subtotal: MONTO_USD,
            },
          ],
        },
      },
    });

    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: costoLocal.id,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no es exterior/i);
  });

  it("rechaza cuenta bancaria USD — debe ser ARS", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaUsdId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/debe ser en ARS/i);
  });

  it("rechaza montoUsdAPagar > saldo pendiente", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
      montoUsdAPagar: "30000.00",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/excede el saldo/i);
  });
});
