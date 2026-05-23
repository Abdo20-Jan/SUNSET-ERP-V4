import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Cobertura del flujo de pago a proveedor exterior USD desde cuenta ARS:
//   - asiento de 2 o 3 líneas con diferencia cambiaria contra 4.3.1.01 / 5.8.2.01
//   - MovimientoTesoreria USD con TC del banco
//   - AplicacionPagoEmbarqueCosto / AplicacionPagoCompra vinculadas a la línea DEBE
//   - saldo USD del proveedor calculado por descripción token (match con
//     getSaldosExteriorPorProveedor del servicio de saldos)

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
const TC_FACTURA = "1398.500000"; // TC original al cargar la factura
const MONTO_USD = "22000.00"; // monto típico de factura mercadería

interface SeedExterior {
  cuentaBancariaArsId: string;
  cuentaBancariaUsdId: string;
  proveedorExteriorId: string;
  proveedorLocalId: string;
  embarqueCostoExteriorId: number;
  compraExteriorId: string;
  embarqueExteriorCodigo: string;
}

describe("pagarFacturaExteriorAction — pago USD desde ARS con TC banco", () => {
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

    // Cuentas contables: banco ARS, banco USD, proveedor exterior, proveedor local,
    // gasto importación, diferencia cambiaria positiva (4.3.1.01) y negativa (5.8.2.01).
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
    await db.prisma.cuentaContable.create({
      data: {
        codigo: "4.3.1.01",
        nombre: "DIFERENCIA DE CAMBIO POSITIVA",
        tipo: "ANALITICA",
        categoria: "INGRESO",
        nivel: 4,
      },
    });
    await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.8.2.01",
        nombre: "DIFERENCIA DE CAMBIO NEGATIVA",
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
        estado: "EN_DEPOSITO", // estado con saldo
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

    // EmbarqueCosto USD del proveedor exterior — factura del servicio de
    // importación (caso menos común pero válido del modelo). Sin IVA/IIBB
    // para que totalUsd = subtotal lineas = MONTO_USD limpio.
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

    // Compra USD del proveedor exterior — mercadería FOB (caso típico
    // SUNSET PARAGUAY → Argentina).
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
    };
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

  async function saldoCuentaPorCodigo(codigo: string): Promise<number> {
    const cuenta = await db.prisma.cuentaContable.findFirst({ where: { codigo } });
    if (!cuenta) return 0;
    const agg = await db.prisma.lineaAsiento.aggregate({
      where: { cuentaId: cuenta.id, asiento: { estado: "CONTABILIZADO" } },
      _sum: { debe: true, haber: true },
    });
    return Number(agg._sum.debe ?? 0) - Number(agg._sum.haber ?? 0);
  }

  it("paga total con TCbanco === TCfactura — 2 líneas, sin diferencia", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: TC_FACTURA,
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    expect(res.tipoDiferencia).toBe("exacto");
    expect(Number(res.diferenciaArs)).toBeCloseTo(0, 2);
    expect(Number(res.montoUsd)).toBeCloseTo(22000, 2);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: res.asientoId },
    });
    expect(lineas).toHaveLength(2);
    await expectAsientoBalanceado(res.asientoId);

    // Sin saldo en cuentas de diferencia cambiaria.
    expect(await saldoCuentaPorCodigo("4.3.1.01")).toBeCloseTo(0, 2);
    expect(await saldoCuentaPorCodigo("5.8.2.01")).toBeCloseTo(0, 2);
  });

  it("paga total con TCbanco < TCfactura — HABER 4.3.1.01 (ganancia)", async () => {
    const s = await seed();
    // TCbanco = 1147,50 < TCfactura 1398,50
    // diff = 22000 × (1398,50 - 1147,50) = 22000 × 251 = 5.522.000 ARS (ganancia)
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    expect(res.tipoDiferencia).toBe("ganancia");
    expect(Number(res.montoArsProveedor)).toBeCloseTo(30767000, 2);
    expect(Number(res.montoArsBanco)).toBeCloseTo(25245000, 2);
    expect(Number(res.diferenciaArs)).toBeCloseTo(5522000, 2);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: res.asientoId },
    });
    expect(lineas).toHaveLength(3);
    await expectAsientoBalanceado(res.asientoId);

    // HABER 4.3.1.01 con saldo = −5.522.000 (categoría INGRESO → saldo
    // acreedor, debe − haber = −5.522.000).
    expect(await saldoCuentaPorCodigo("4.3.1.01")).toBeCloseTo(-5522000, 2);
    expect(await saldoCuentaPorCodigo("5.8.2.01")).toBeCloseTo(0, 2);
  });

  it("paga total con TCbanco > TCfactura — DEBE 5.8.2.01 (pérdida)", async () => {
    const s = await seed();
    // TCbanco = 1500 > TCfactura 1398,50
    // diff = 22000 × (1398,50 - 1500) = -2.233.000 → pérdida 2.233.000 ARS
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1500.000000",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    expect(res.tipoDiferencia).toBe("perdida");
    expect(Number(res.diferenciaArs)).toBeCloseTo(-2233000, 2);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: res.asientoId },
    });
    expect(lineas).toHaveLength(3);
    await expectAsientoBalanceado(res.asientoId);

    expect(await saldoCuentaPorCodigo("5.8.2.01")).toBeCloseTo(2233000, 2);
    expect(await saldoCuentaPorCodigo("4.3.1.01")).toBeCloseTo(0, 2);
  });

  it("paga parcial — saldo restante consistente con segundo pago", async () => {
    const s = await seed();
    // Primer pago: 10.000 USD de los 22.000 (TC banco === TC factura para
    // simplificar — sin diferencia).
    const r1 = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: TC_FACTURA,
      fecha: FECHA_PAGO,
      montoUsdAPagar: "10000.00",
    });
    if (!r1.ok) throw new Error(`primer pago falló: ${r1.error}`);

    // Segundo pago: 12.000 USD (el saldo restante) — debe pasar.
    const r2 = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: TC_FACTURA,
      fecha: FECHA_PAGO,
      montoUsdAPagar: "12000.00",
    });
    if (!r2.ok) throw new Error(`segundo pago falló: ${r2.error}`);

    // Tercer intento: cualquier monto adicional debe rechazarse.
    const r3 = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: TC_FACTURA,
      fecha: FECHA_PAGO,
      montoUsdAPagar: "100.00",
    });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toMatch(/no tiene saldo|excede/i);

    // Validar AplicacionPagoEmbarqueCosto registradas (2 pagos parciales).
    const aplicaciones = await db.prisma.aplicacionPagoEmbarqueCosto.findMany({
      where: { embarqueCostoId: s.embarqueCostoExteriorId },
    });
    expect(aplicaciones).toHaveLength(2);
    const sumaArs = aplicaciones.reduce((acc, a) => acc + Number(a.montoArs), 0);
    expect(sumaArs).toBeCloseTo(22000 * Number(TC_FACTURA), 2);
  });

  it("paga via Compra USD (proveedor exterior) — registra AplicacionPagoCompra", async () => {
    const s = await seed();
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "compra",
      facturaId: s.compraExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1147.500000",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);
    expect(res.tipoDiferencia).toBe("ganancia");
    await expectAsientoBalanceado(res.asientoId);

    const aplicaciones = await db.prisma.aplicacionPagoCompra.findMany({
      where: { compraId: s.compraExteriorId },
    });
    expect(aplicaciones).toHaveLength(1);
    expect(Number(aplicaciones[0]!.montoArs)).toBeCloseTo(22000 * Number(TC_FACTURA), 2);
  });

  it("rechaza proveedor local (tipoProveedor MERCADERIA_LOCAL + pais AR)", async () => {
    const s = await seed();
    // Crear EmbarqueCosto del proveedor local — pero estructura idéntica.
    const cuentaGasto = await db.prisma.cuentaContable.findFirstOrThrow({
      where: { codigo: "5.2.1.01" },
    });
    const embarqueLocal = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-LOCAL",
        proveedorId: s.proveedorLocalId,
        moneda: "USD",
        tipoCambio: TC_FACTURA,
        depositoDestinoId: (
          await db.prisma.deposito.findFirstOrThrow({ where: { nombre: "Nacional" } })
        ).id,
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
      tipoCambioBanco: TC_FACTURA,
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
      tipoCambioBanco: TC_FACTURA,
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
      tipoCambioBanco: TC_FACTURA,
      fecha: FECHA_PAGO,
      montoUsdAPagar: "30000.00", // > 22.000 saldo
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/excede el saldo/i);
  });

  it("error claro si falta cuenta 5.8.2.01 (caso pérdida cambiaria)", async () => {
    const s = await seed();
    // Borrar la cuenta de pérdida — el caso ganancia no debe activarse.
    await db.prisma.cuentaContable.delete({ where: { codigo: "5.8.2.01" } });

    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "embarqueCosto",
      facturaId: s.embarqueCostoExteriorId,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1500.000000", // TC mayor → pérdida
      fecha: FECHA_PAGO,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/5\.8\.2\.01/);
  });
});
