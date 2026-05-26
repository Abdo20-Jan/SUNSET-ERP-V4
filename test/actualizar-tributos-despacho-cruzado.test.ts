import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Gap #4 — editor de tributos/VEP en el despacho parcial CRUZADO.
// `actualizarTributosDespachoCruzadoAction` escribe los 7 tributos + TC en un
// borrador cruzado (Despacho BORRADOR materializado, tributos=0 por defecto) y
// (re)vincula facturas DESPACHO. Después `contabilizarDespachoAction` debe usar
// esos valores: VEP = Σ tributos × TC y el asiento contiene la línea del tributo.

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

import {
  actualizarTributosDespachoCruzadoAction,
  contabilizarDespachoAction,
} from "@/lib/actions/despachos";

const FECHA = new Date("2025-06-15T12:00:00.000Z");

describe("actualizarTributosDespachoCruzadoAction (gap #4)", () => {
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
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    await db.reset([
      "AplicacionPagoEmbarqueCosto",
      "LineaAsiento",
      "Asiento",
      "MovimientoStock",
      "Transferencia",
      "StockPorDeposito",
      "VepDespacho",
      "ItemDespacho",
      "EmbarqueCostoLinea",
      "EmbarqueCosto",
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
    embarqueId: string;
    despachoId: string;
    proveedorId: string;
    productoId: string;
    facturaDespachoId: number;
  }

  // Custo FC 12.50 USD × TC 1000 × 30 = 375000 ARS (nacionalizado).
  // Despacho materializado con tributos=0 (como deja contabilizarBorrador).
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
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Despachante SA" } });
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
        proveedorId: prov.id,
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
        // tributos = 0 (default), tal como los deja la materialización del borrador.
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
    // Factura DESPACHO suelta (despachoId=null) para vincular vía la action.
    const factura = await db.prisma.embarqueCosto.create({
      data: {
        embarqueId: embarque.id,
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        momento: "DESPACHO",
        estado: "BORRADOR",
        facturaNumero: "F-001",
      },
    });
    return {
      embarqueId: embarque.id,
      despachoId: despacho.id,
      proveedorId: prov.id,
      productoId: prod.id,
      facturaDespachoId: factura.id,
    };
  }

  it("setea los 7 tributos + TC y el VEP/asiento los usan al contabilizar", async () => {
    const s = await seed();

    const upd = await actualizarTributosDespachoCruzadoAction({
      despachoId: s.despachoId,
      tipoCambio: "1000",
      die: "100.00",
      tasaEstadistica: "10.00",
      arancelSim: "20.00",
      iva: "5.00",
      ivaAdicional: "3.00",
      iibb: "1.00",
      ganancias: "2.00",
    });
    expect(upd.ok).toBe(true);

    // Persistió en el Despacho.
    const dPost = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    expect(dPost.die.toFixed(2)).toBe("100.00");
    expect(dPost.tasaEstadistica.toFixed(2)).toBe("10.00");
    expect(dPost.ganancias.toFixed(2)).toBe("2.00");
    expect(dPost.tipoCambio.toFixed(2)).toBe("1000.00");

    // Contabilizar: VEP = Σ tributos (141) × TC 1000 = 141000.
    const res = await contabilizarDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const vep = await db.prisma.vepDespacho.findUniqueOrThrow({
      where: { despachoId: s.despachoId },
    });
    expect(vep.montoTotal.toFixed(2)).toBe("141000.00");

    // El asiento contiene la línea del tributo DIE (100 × 1000 = 100000 en el DEBE).
    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: despacho.asientoId! },
    });
    const totalDebe = lineas.reduce((acc, l) => acc + Number(l.debe), 0);
    // 375000 nacionalización + 141 tributos × 1000 = 516000.
    expect(totalDebe).toBeCloseTo(516000, 2);
  });

  it("rechaza si el despacho ya está CONTABILIZADO", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);
    const upd = await actualizarTributosDespachoCruzadoAction({
      despachoId: s.despachoId,
      tipoCambio: "1000",
      die: "50.00",
    });
    expect(upd.ok).toBe(false);
  });

  it("vincula una factura DESPACHO que luego entra en el asiento/CxP", async () => {
    const s = await seed();

    const upd = await actualizarTributosDespachoCruzadoAction({
      despachoId: s.despachoId,
      tipoCambio: "1000",
      die: "100.00",
      facturasIds: [s.facturaDespachoId],
    });
    expect(upd.ok).toBe(true);

    // La factura quedó linkada al despacho (aparece en despacho.costos).
    const factura = await db.prisma.embarqueCosto.findUniqueOrThrow({
      where: { id: s.facturaDespachoId },
    });
    expect(factura.despachoId).toBe(s.despachoId);

    const costos = await db.prisma.embarqueCosto.findMany({ where: { despachoId: s.despachoId } });
    expect(costos).toHaveLength(1);

    // Desvincular: llamar de nuevo sin la factura la suelta.
    const upd2 = await actualizarTributosDespachoCruzadoAction({
      despachoId: s.despachoId,
      tipoCambio: "1000",
      die: "100.00",
      facturasIds: [],
    });
    expect(upd2.ok).toBe(true);
    const facturaPost = await db.prisma.embarqueCosto.findUniqueOrThrow({
      where: { id: s.facturaDespachoId },
    });
    expect(facturaPost.despachoId).toBeNull();
  });
});
