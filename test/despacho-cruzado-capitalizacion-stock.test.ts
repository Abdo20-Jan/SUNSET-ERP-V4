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
    expect(debePorCuenta.get("1.1.5.01")).toBeCloseTo(545000, 2);
    // HABER 1.1.5.05 = sólo nacionalizado 375000.
    expect(haberPorCuenta.get("1.1.5.05")).toBeCloseTo(375000, 2);

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
    expect(debePorCuenta.get("1.1.4.04")).toBeCloseTo(5000, 2); // IVA importación
    expect(debePorCuenta.get("1.1.4.05")).toBeCloseTo(3000, 2); // IVA adicional
    expect(debePorCuenta.get("1.1.4.06")).toBeCloseTo(1000, 2); // IIBB importación
    expect(debePorCuenta.get("1.1.4.07")).toBeCloseTo(2000, 2); // Ganancias

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
});
