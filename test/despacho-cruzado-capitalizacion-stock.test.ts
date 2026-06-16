import Decimal from "decimal.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Fix Comex "Modelo Y" / despacho parcial cruzado:
//  (1) Tributos capitalizables (DIE + Tasa + Arancel) + subtotal de facturas
//      DESPACHO integran el costo de la mercadería (DEBE 1.1.5.01), no egreso.
//      IVA/IVA adicional/IIBB/Ganancias siguen como crédito fiscal.
//  (2) Producto.stockActual / costoPromedio reflejan SÓLO el stock en
//      depósitos NACIONAL (vendable), usando el costo LANDED.

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

import { contabilizarDespachoAction } from "@/lib/actions/despachos";

const FECHA = new Date("2025-06-15T12:00:00.000Z");

describe("despacho cruzado — capitalización de tributos/facturas + stock NACIONAL", () => {
  let db: TestDb;
  let cuentaProvId: number;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    await db.reset([
      "LineaAsiento",
      "Asiento",
      "MovimientoStock",
      "Transferencia",
      "StockPorDeposito",
      "VepDespacho",
      "EmbarqueCostoLinea",
      "EmbarqueCosto",
      "ItemDespacho",
      "Despacho",
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Deposito",
      "Producto",
      "Proveedor",
      "PeriodoContable",
      "CuentaContable",
    ]);
  });

  interface Seed {
    despachoId: string;
    depFiscalId: string;
    depDestinoId: string;
    productoId: string;
  }

  // Nacionalizado: costoFC 12.50 × TC 1000 × 30 = 375000.
  // Capitalizables: (DIE 100 + Tasa 10 + Arancel 20) × 1000 = 130000
  //               + factura DESPACHO subtotal 40 × TC 1000 = 40000  ⇒ 170000.
  // DEBE 1.1.5.01 = 545000 ; HABER 1.1.5.05 = 375000.
  // Crédito fiscal (no capitaliza): IVA 5 + IVAad 3 + IIBB 1 + Gan 2.
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
    const cuentaProv = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.99",
        nombre: "PROVEEDOR DESPACHANTE TEST",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 4,
      },
    });
    cuentaProvId = cuentaProv.id;
    const cuentaGasto = await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.7.2.99",
        nombre: "GASTO DESPACHO TEST",
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
      },
    });
    const provExt = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const provDesp = await db.prisma.proveedor.create({
      data: { nombre: "Despachante SA", cuentaContableId: cuentaProv.id },
    });
    const prod = await db.prisma.producto.create({
      data: { codigo: "SKU-1", nombre: "Neumático" },
    });
    const depFiscal = await db.prisma.deposito.create({
      data: { nombre: "DF Aduana", tipo: "ZONA_PRIMARIA" },
    });
    const depDestino = await db.prisma.deposito.create({
      data: { nombre: "Nacional", tipo: "NACIONAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-X",
        proveedorId: provExt.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        depositoDestinoId: depDestino.id,
      },
    });
    const itemEmbarque = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prod.id,
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0000001",
        estado: "DESCONSOLIDADO",
        depositoFiscalId: depFiscal.id,
      },
    });
    const ic = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: itemEmbarque.id,
        productoId: prod.id,
        cantidadDeclarada: 60,
        cantidadFisica: 60,
        cantidadEnDespacho: 30,
        costoFCUnitario: "12.5000",
      },
    });
    // Stock ya en el DF (lo ingresó la desconsolidación).
    await db.prisma.stockPorDeposito.create({
      data: {
        productoId: prod.id,
        depositoId: depFiscal.id,
        cantidadFisica: 60,
        costoPromedio: "12500.00",
      },
    });
    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: "EMB-X-D1",
        embarqueId: embarque.id,
        fecha: FECHA,
        estado: "BORRADOR",
        tipoCambio: "1000.000000",
        die: "100.00",
        tasaEstadistica: "10.00",
        arancelSim: "20.00",
        iva: "5.00",
        ivaAdicional: "3.00",
        iibb: "1.00",
        ganancias: "2.00",
        items: {
          create: [
            {
              itemEmbarqueId: itemEmbarque.id,
              contenedorId: contenedor.id,
              itemContenedorId: ic.id,
              cantidad: 30,
            },
          ],
        },
      },
    });
    // Factura DESPACHO linkada (capitaliza subtotal; IVA va a crédito fiscal).
    await db.prisma.embarqueCosto.create({
      data: {
        embarqueId: embarque.id,
        proveedorId: provDesp.id,
        despachoId: despacho.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        momento: "DESPACHO",
        estado: "BORRADOR",
        facturaNumero: "F-DESP-1",
        iva: "0",
        iibb: "0",
        otros: "0",
        lineas: {
          create: [
            {
              tipo: "HONORARIOS_DESPACHANTE",
              cuentaContableGastoId: cuentaGasto.id,
              descripcion: "Honorarios despachante",
              subtotal: "40.00",
            },
          ],
        },
      },
    });
    return {
      despachoId: despacho.id,
      depFiscalId: depFiscal.id,
      depDestinoId: depDestino.id,
      productoId: prod.id,
    };
  }

  it("capitaliza DIE+Tasa+Arancel+factura DESPACHO en 1.1.5.01 y el asiento balancea", async () => {
    const s = await seed();
    const res = await contabilizarDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: despacho.asientoId! },
      include: { cuenta: { select: { codigo: true } } },
    });
    const debePorCuenta = new Map<string, number>();
    const haberPorCuenta = new Map<string, number>();
    for (const l of lineas) {
      if (l.debe.gt(0)) debePorCuenta.set(l.cuenta.codigo, Number(l.debe));
      if (l.haber.gt(0)) haberPorCuenta.set(l.cuenta.codigo, Number(l.haber));
    }

    // DEBE 1.1.5.01 = nacionalizado 375000 + capitalizables 170000 = 545000.
    expect(debePorCuenta.get("1.1.7.01")).toBeCloseTo(545000, 2);
    // HABER 1.1.5.05 = sólo nacionalizado 375000.
    expect(haberPorCuenta.get("1.1.7.04")).toBeCloseTo(375000, 2);

    // Tributos capitalizables YA NO van a egreso 5.7.1.x.
    expect(debePorCuenta.has("5.7.1.01")).toBe(false); // DIE
    expect(debePorCuenta.has("5.7.1.02")).toBe(false); // Tasa
    expect(debePorCuenta.has("5.7.1.03")).toBe(false); // Arancel
    // Subtotal de la factura DESPACHO NO va a la cuenta de gasto (capitalizado).
    expect(debePorCuenta.has("5.7.2.99")).toBe(false);

    // Pasivos aduaneros por pagar PERMANECEN (la obligación a pagar).
    expect(haberPorCuenta.get("2.1.5.01")).toBeCloseTo(100000, 2); // DIE por pagar
    expect(haberPorCuenta.get("2.1.5.02")).toBeCloseTo(10000, 2); // Tasa por pagar
    expect(haberPorCuenta.get("2.1.5.03")).toBeCloseTo(20000, 2); // Arancel por pagar

    // Factura DESPACHO: HABER al proveedor (CxP) por el total ARS.
    const provCodigo = (
      await db.prisma.cuentaContable.findUniqueOrThrow({ where: { id: cuentaProvId } })
    ).codigo;
    expect(haberPorCuenta.get(provCodigo)).toBeCloseTo(40000, 2); // 40 × 1000

    // IVA/IIBB/Ganancias de aduana siguen como crédito fiscal (no capitalizan).
    expect(debePorCuenta.get("1.1.5.1.03")).toBeCloseTo(5000, 2); // IVA importación
    expect(debePorCuenta.get("1.1.5.1.04")).toBeCloseTo(3000, 2); // IVA adicional
    expect(debePorCuenta.get("1.1.5.2.01")).toBeCloseTo(1000, 2); // IIBB importación
    expect(debePorCuenta.get("1.1.5.3.01")).toBeCloseTo(2000, 2); // Ganancias

    // Asiento balanceado.
    const totalDebe = lineas.reduce((acc, l) => acc + Number(l.debe), 0);
    const totalHaber = lineas.reduce((acc, l) => acc + Number(l.haber), 0);
    expect(totalDebe).toBeCloseTo(totalHaber, 2);
  });

  it("Producto.stockActual = unidades NACIONALIZADAS y costoPromedio ≈ landed", async () => {
    const s = await seed();
    const res = await contabilizarDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const prod = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoId } });
    // Sólo el stock nacionalizado (NACIONAL) cuenta: 30 unidades.
    expect(prod.stockActual).toBe(30);
    // costoPromedio = landed = 545000 / 30 = 18166.6667 → redondeado money() a 2dp.
    expect(Number(prod.costoPromedio)).toBeCloseTo(18166.67, 2);

    // ItemDespacho.costoUnitario refleja el landed (no el FC puro 12500).
    const items = await db.prisma.itemDespacho.findMany({ where: { despachoId: s.despachoId } });
    expect(Number(items[0]?.costoUnitario)).toBeCloseTo(18166.67, 2);
  });

  it("las unidades que quedaron en ZPA/DF NO entran en stockActual", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);

    // En el DF (ZONA_PRIMARIA) quedan 30 unidades (60 - 30 despachadas).
    const spdDF = await db.prisma.stockPorDeposito.findUniqueOrThrow({
      where: { productoId_depositoId: { productoId: s.productoId, depositoId: s.depFiscalId } },
    });
    expect(spdDF.cantidadFisica).toBe(30);

    // Pero el Producto.stockActual sólo cuenta el NACIONAL (30), no 60.
    const prod = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoId } });
    expect(prod.stockActual).toBe(30);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Regresión piloto AR-251223036CN-D4 (TC despacho decimal 1399.5).
  // ──────────────────────────────────────────────────────────────────────
  // El asiento credita cada tributo aduanero por separado, redondeando
  // ARS por tributo:
  //   round2(DIE×TC), round2(Tasa×TC), round2(Arancel×TC).
  // Si el helper de costo landed suma USD primero y redondea una vez al
  // final, con TC decimal los medios centavos (half-up) divergen y la
  // suma de HABERs aduana queda 0.01 arriba del DEBE 1.1.5.01.
  // Este test fuerza ese half-up y asserta DEBE == HABER al centavo.
  //
  // Aritmética exacta (D4):
  //  - DIE     1768.25 × 1399.5 = 2,474,665.875 → 2,474,665.88
  //  - Tasa     331.55 × 1399.5 =   464,004.225 →   464,004.23
  //  - Arancel   10.00 × 1399.5 =    13,995.000 →    13,995.00
  //  Σ HABERs aduana capitalizables = 2,952,665.11
  async function seedTcDecimal(): Promise<Seed> {
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-12",
        nombre: "Diciembre 2025",
        fechaInicio: new Date("2025-12-01T00:00:00.000Z"),
        fechaFin: new Date("2025-12-31T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
    const cuentaProv = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.98",
        nombre: "PROVEEDOR DESPACHANTE D4",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 4,
      },
    });
    cuentaProvId = cuentaProv.id;
    const provExt = await db.prisma.proveedor.create({ data: { nombre: "Fab China SA" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "SKU-D4", nombre: "Neumático 036CN" },
    });
    const depFiscal = await db.prisma.deposito.create({
      data: { nombre: "DF Aduana D4", tipo: "ZONA_PRIMARIA" },
    });
    const depDestino = await db.prisma.deposito.create({
      data: { nombre: "Nacional D4", tipo: "NACIONAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-036CN",
        proveedorId: provExt.id,
        moneda: "USD",
        tipoCambio: "1382.000000",
        depositoDestinoId: depDestino.id,
      },
    });
    const itemEmbarque = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prod.id,
        cantidad: 100,
        precioUnitarioFob: "123.0709",
      },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: {
        embarqueId: embarque.id,
        numeroContenedor: "MSCU0036CN1",
        estado: "DESCONSOLIDADO",
        depositoFiscalId: depFiscal.id,
      },
    });
    const ic = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: itemEmbarque.id,
        productoId: prod.id,
        cantidadDeclarada: 100,
        cantidadFisica: 100,
        cantidadEnDespacho: 100,
        costoFCUnitario: "123.0709",
      },
    });
    await db.prisma.stockPorDeposito.create({
      data: {
        productoId: prod.id,
        depositoId: depFiscal.id,
        cantidadFisica: 100,
        costoPromedio: "170083.98",
      },
    });
    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: "EMB-036CN-D4",
        embarqueId: embarque.id,
        fecha: new Date("2025-12-23T12:00:00.000Z"),
        estado: "BORRADOR",
        tipoCambio: "1399.500000",
        die: "1768.25",
        tasaEstadistica: "331.55",
        arancelSim: "10.00",
        iva: "0",
        ivaAdicional: "0",
        iibb: "0",
        ganancias: "0",
        items: {
          create: [
            {
              itemEmbarqueId: itemEmbarque.id,
              contenedorId: contenedor.id,
              itemContenedorId: ic.id,
              cantidad: 100,
            },
          ],
        },
      },
    });
    return {
      despachoId: despacho.id,
      depFiscalId: depFiscal.id,
      depDestinoId: depDestino.id,
      productoId: prod.id,
    };
  }

  it("TC decimal (1399.5): asiento balancea al centavo (DEBE == HABER)", async () => {
    const s = await seedTcDecimal();
    const res = await contabilizarDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: despacho.asientoId! },
      include: { cuenta: { select: { codigo: true } } },
    });

    // Σ DEBE == Σ HABER exacto al centavo (no toBeCloseTo: queremos cero diferencia).
    const totalDebe = lineas.reduce((acc, l) => acc.plus(l.debe.toString()), new Decimal(0));
    const totalHaber = lineas.reduce((acc, l) => acc.plus(l.haber.toString()), new Decimal(0));
    expect(totalDebe.toFixed(2)).toBe(totalHaber.toFixed(2));

    // DEBE 1.1.5.01 = nacionalizado 17,008,398.00 + tributos capitalizables
    //   2,952,665.11 = 19,961,063.11 (NO 19,961,063.10 del agregado).
    const debePorCuenta = new Map<string, string>();
    const haberPorCuenta = new Map<string, string>();
    for (const l of lineas) {
      const debe = new Decimal(l.debe.toString());
      const haber = new Decimal(l.haber.toString());
      if (debe.gt(0)) debePorCuenta.set(l.cuenta.codigo, debe.toFixed(2));
      if (haber.gt(0)) haberPorCuenta.set(l.cuenta.codigo, haber.toFixed(2));
    }
    expect(debePorCuenta.get("1.1.7.01")).toBe("19961063.11");
    expect(haberPorCuenta.get("1.1.7.04")).toBe("17008398.00");

    // Pasivos aduaneros por separado (cada uno round2(tributo×TCdsp)).
    expect(haberPorCuenta.get("2.1.5.01")).toBe("2474665.88"); // DIE
    expect(haberPorCuenta.get("2.1.5.02")).toBe("464004.23"); // Tasa
    expect(haberPorCuenta.get("2.1.5.03")).toBe("13995.00"); // Arancel
  });

  it("TC decimal + factura DESPACHO en USD con TC ≠ embarque: balancea y capitaliza", async () => {
    // Previene regresión simétrica del lado facturas (cada factura ya redondea
    // round2(subtotal×TCfactura) en el reduce — pero confirmamos en integración).
    const s = await seedTcDecimal();
    const provDesp = await db.prisma.proveedor.create({
      data: { nombre: "Despachante D4", cuentaContableId: cuentaProvId },
    });
    const cuentaGasto = await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.7.2.98",
        nombre: "GASTO DESPACHO D4",
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
      },
    });
    // Factura USD con TC factura distinto (1410.75) — fuerza otro half-up.
    await db.prisma.embarqueCosto.create({
      data: {
        embarqueId: (
          await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } })
        ).embarqueId,
        proveedorId: provDesp.id,
        despachoId: s.despachoId,
        moneda: "USD",
        tipoCambio: "1410.750000",
        momento: "DESPACHO",
        estado: "BORRADOR",
        facturaNumero: "F-D4-1",
        iva: "0",
        iibb: "0",
        otros: "0",
        lineas: {
          create: [
            {
              tipo: "HONORARIOS_DESPACHANTE",
              cuentaContableGastoId: cuentaGasto.id,
              descripcion: "Honorarios D4",
              subtotal: "127.35",
            },
          ],
        },
      },
    });

    const res = await contabilizarDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: despacho.asientoId! },
    });
    const totalDebe = lineas.reduce((acc, l) => acc.plus(l.debe.toString()), new Decimal(0));
    const totalHaber = lineas.reduce((acc, l) => acc.plus(l.haber.toString()), new Decimal(0));
    expect(totalDebe.toFixed(2)).toBe(totalHaber.toFixed(2));
  });
});
