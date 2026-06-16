import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// getSaldosExteriorPorProveedor — pagado USD desde montoOrigen/aplicaciones.
//
// Bug original (auditoría 2026-06): el servicio leía `debe − haber` de la
// línea DEBE como si fuera USD. Como el pago exterior graba debe en ARS
// (montoUsd × TC), una factura USD 22.000 con pago parcial de 10.000 USD
// aparecía "pagada" por 11.475.000 → saldo negativo → la factura (y hasta
// el proveedor) DESAPARECÍA de la vista con deuda real pendiente.
//
// Modelo canónico (regla pago exterior): debe/haber viven en ARS; el
// principal USD es metadata (monedaOrigen/montoOrigen) invariante a TC.
// AplicacionPago* ancla pago↔factura (layer 0); tokens en la descripción
// quedan como fallback para pagos legacy y embarqueFob.

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
import { getSaldosExteriorPorProveedor } from "@/lib/services/cuentas-a-pagar";

const FECHA_FACTURA = new Date("2025-06-15T12:00:00.000Z");
const FECHA_PAGO = new Date("2025-06-20T12:00:00.000Z");
const TC_FACTURA = "1398.500000";
const MONTO_USD = "22000.00"; // total del costo Y del FOB (100 × 220)

interface Seed {
  cuentaBancariaArsId: string;
  proveedorExteriorId: string;
  embarqueId: string;
  embarqueCodigo: string;
  embarqueCostoId: number;
}

describe("getSaldosExteriorPorProveedor — pagado USD por montoOrigen/aplicaciones", () => {
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

  async function seed(): Promise<Seed> {
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
    const cuentaProvExterior = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.99.EXT",
        nombre: "SUNSET PARAGUAY",
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

    const proveedorExterior = await db.prisma.proveedor.create({
      data: {
        nombre: "SUNSET PARAGUAY",
        tipoProveedor: "MERCADERIA_EXTERIOR",
        pais: "PY",
        cuentaContableId: cuentaProvExterior.id,
      },
    });

    const producto = await db.prisma.producto.create({
      data: { codigo: "SKU-EXT", nombre: "Neumático EXT" },
    });
    const depDestino = await db.prisma.deposito.create({
      data: { nombre: "Nacional", tipo: "NACIONAL" },
    });

    const embarque = await db.prisma.embarque.create({
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
        embarqueId: embarque.id,
        productoId: producto.id,
        cantidad: 100,
        precioUnitarioFob: "220.00",
      },
    });

    const embarqueCosto = await db.prisma.embarqueCosto.create({
      data: {
        embarqueId: embarque.id,
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

    return {
      cuentaBancariaArsId: cuentaBancariaArs.id,
      proveedorExteriorId: proveedorExterior.id,
      embarqueId: embarque.id,
      embarqueCodigo: embarque.codigo,
      embarqueCostoId: embarqueCosto.id,
    };
  }

  function facturaDe(
    saldos: Awaited<ReturnType<typeof getSaldosExteriorPorProveedor>>,
    proveedorId: string,
    numero: string,
  ) {
    const prov = saldos.find((p) => p.proveedorId === proveedorId);
    if (!prov) return undefined;
    const todas = [...prov.embarques.flatMap((e) => e.facturas), ...prov.facturasSueltas];
    return todas.find((f) => f.numero === numero);
  }

  // ============================================================
  // Bug crítico: pago parcial NO hace desaparecer la factura
  // ============================================================

  it("pago parcial USD 10.000 — la factura sigue con saldo USD 12.000 (no desaparece)", async () => {
    const s = await seed();

    const pago = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
      montoUsdAPagar: "10000.00",
    });
    if (!pago.ok) throw new Error(`pago falló: ${pago.error}`);

    const saldos = await getSaldosExteriorPorProveedor();
    const factura = facturaDe(saldos, s.proveedorExteriorId, "INV-2025-036");
    expect(factura).toBeDefined();
    // Pre-fix: pagado = debe ARS 11.475.000 leído como USD → saldo negativo
    // → factura filtrada de la vista con 12.000 USD reales pendientes.
    expect(Number(factura?.pagadoUsd)).toBeCloseTo(10000, 2);
    expect(Number(factura?.saldoUsd)).toBeCloseTo(12000, 2);
  });

  it("validación de la action coincide con la vista — segundo pago > saldo rechazado", async () => {
    const s = await seed();

    const p1 = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
      montoUsdAPagar: "10000.00",
    });
    if (!p1.ok) throw new Error(`primer pago falló: ${p1.error}`);

    const p2 = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1200.000000",
      fecha: FECHA_PAGO,
      montoUsdAPagar: "13000.00", // saldo real = 12.000
    });
    expect(p2.ok).toBe(false);
    if (!p2.ok) expect(p2.error).toMatch(/excede el saldo/i);
  });

  // ============================================================
  // Layer 0 — AplicacionPago* manda; tokens no provocan doble descuento
  // ============================================================

  it("pago total del costo NO descuenta la deuda FOB virtual del mismo embarque", async () => {
    const s = await seed();

    // Pago 100% del costo (su descripción contiene el código del embarque).
    const pago = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
    });
    if (!pago.ok) throw new Error(`pago falló: ${pago.error}`);

    const saldos = await getSaldosExteriorPorProveedor();
    // El costo quedó saldado → ya no bloquea la factura FOB virtual del
    // embarque, que aparece con su deuda íntegra: el pago del costo tiene
    // AplicacionPagoEmbarqueCosto y NO puede contar para el FOB aunque la
    // descripción comparta el token EMB-036CN.
    const fob = facturaDe(saldos, s.proveedorExteriorId, s.embarqueCodigo);
    expect(fob).toBeDefined();
    expect(fob?.origen).toBe("embarqueFob");
    expect(Number(fob?.pagadoUsd)).toBeCloseTo(0, 2);
    expect(Number(fob?.saldoUsd)).toBeCloseTo(22000, 2);
    // Y el costo pagado no aparece más.
    expect(facturaDe(saldos, s.proveedorExteriorId, "INV-2025-036")).toBeUndefined();
  });

  // ============================================================
  // Fallback legacy — línea sin metadata usa el monto USD del movimiento
  // ============================================================

  it("pago legacy (sin montoOrigen ni aplicación) descuenta por mov.monto + tokens", async () => {
    const s = await seed();

    const pago = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
      montoUsdAPagar: "5000.00",
    });
    if (!pago.ok) throw new Error(`pago falló: ${pago.error}`);

    // Simular pago pre-fix: despojar metadata USD y aplicación, y restaurar
    // el header legado (asiento.moneda=USD, como quedaron los asientos
    // históricos antes del libro ARS-único de E3) → queda sólo el asiento
    // USD 2-líneas con debe en ARS + mov PAGO USD.
    await db.prisma.lineaAsiento.updateMany({
      where: { asientoId: pago.asientoId, debe: { gt: 0 } },
      data: { monedaOrigen: null, montoOrigen: null, tipoCambioOrigen: null },
    });
    await db.prisma.asiento.update({
      where: { id: pago.asientoId },
      data: { moneda: "USD", tipoCambio: "1147.500000" },
    });
    await db.prisma.aplicacionPagoEmbarqueCosto.deleteMany({
      where: { embarqueCostoId: s.embarqueCostoId },
    });

    const saldos = await getSaldosExteriorPorProveedor();
    const factura = facturaDe(saldos, s.proveedorExteriorId, "INV-2025-036");
    expect(factura).toBeDefined();
    expect(Number(factura?.pagadoUsd)).toBeCloseTo(5000, 2);
    expect(Number(factura?.saldoUsd)).toBeCloseTo(17000, 2);
  });

  it("pago legacy multi-DEBE (USD crudo) — cada línea aporta su debe, no el total del movimiento", async () => {
    const s = await seed();
    const periodo = await db.prisma.periodoContable.findFirstOrThrow();
    const cuentaProv = await db.prisma.cuentaContable.findFirstOrThrow({
      where: { codigo: "2.1.1.99.EXT" },
    });
    const cuentaBanco = await db.prisma.cuentaContable.findFirstOrThrow({
      where: { codigo: "1.1.2.01" },
    });

    // Asiento legacy batch: moneda USD, líneas grabadas en USD CRUDO,
    // 2 líneas DEBE en la cuenta del proveedor (sólo una referencia la
    // factura). El movimiento PAGO USD lleva el total (8.000).
    const asiento = await db.prisma.asiento.create({
      data: {
        numero: 9999,
        fecha: FECHA_PAGO,
        descripcion: "Pago batch legacy USD",
        estado: "CONTABILIZADO",
        origen: "TESORERIA",
        moneda: "USD",
        tipoCambio: "1147.500000",
        totalDebe: "8000.00",
        totalHaber: "8000.00",
        periodoId: periodo.id,
        lineas: {
          create: [
            {
              cuentaId: cuentaProv.id,
              debe: "5000.00",
              haber: 0,
              descripcion: "Pago INV-2025-036 EMB-036CN",
            },
            {
              cuentaId: cuentaProv.id,
              debe: "3000.00",
              haber: 0,
              descripcion: "Pago otra deuda sin factura",
            },
            { cuentaId: cuentaBanco.id, debe: 0, haber: "8000.00", descripcion: "Salida banco" },
          ],
        },
      },
    });
    await db.prisma.movimientoTesoreria.create({
      data: {
        tipo: "PAGO",
        cuentaBancariaId: s.cuentaBancariaArsId,
        fecha: FECHA_PAGO,
        monto: "8000.00",
        moneda: "USD",
        tipoCambio: "1147.500000",
        cuentaContableId: cuentaProv.id,
        descripcion: "Pago batch legacy USD",
        asientoId: asiento.id,
      },
    });

    const saldos = await getSaldosExteriorPorProveedor();
    const factura = facturaDe(saldos, s.proveedorExteriorId, "INV-2025-036");
    expect(factura).toBeDefined();
    // Multi-DEBE legacy: la línea que matchea aporta su debe (USD crudo
    // 5.000) — no el monto total del movimiento (8.000).
    expect(Number(factura?.pagadoUsd)).toBeCloseTo(5000, 2);
    expect(Number(factura?.saldoUsd)).toBeCloseTo(17000, 2);
  });

  // ============================================================
  // embarqueFob canónico — montoOrigen + tokens (sin tabla de aplicación)
  // ============================================================

  it("pago parcial de embarqueFob descuenta exactamente los USD pagados", async () => {
    const s = await seed();
    // Embarque FOB-only: sin EmbarqueCosto → deuda sólo en items.
    const producto = await db.prisma.producto.create({
      data: { codigo: "SKU-FOB", nombre: "Neumático FOB only" },
    });
    const dep = await db.prisma.deposito.findFirstOrThrow({ where: { nombre: "Nacional" } });
    const embarqueFob = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-FOB-ONLY",
        proveedorId: s.proveedorExteriorId,
        moneda: "USD",
        tipoCambio: TC_FACTURA,
        depositoDestinoId: dep.id,
        estado: "EN_ZONA_PRIMARIA",
      },
    });
    await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarqueFob.id,
        productoId: producto.id,
        cantidad: 100,
        precioUnitarioFob: "220.00",
      },
    });

    const pago = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueFob",
      facturaId: embarqueFob.id,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1200.000000",
      fecha: FECHA_PAGO,
      montoUsdAPagar: "8000.00",
    });
    if (!pago.ok) throw new Error(`pago falló: ${pago.error}`);

    const saldos = await getSaldosExteriorPorProveedor();
    const fob = facturaDe(saldos, s.proveedorExteriorId, "EMB-FOB-ONLY");
    expect(fob).toBeDefined();
    expect(fob?.origen).toBe("embarqueFob");
    // Pre-fix: pagado = ARS 9.600.000 leído como USD → el embarque (y el
    // proveedor entero, si era su única deuda) desaparecía de la vista.
    expect(Number(fob?.pagadoUsd)).toBeCloseTo(8000, 2);
    expect(Number(fob?.saldoUsd)).toBeCloseTo(14000, 2);
  });
});
