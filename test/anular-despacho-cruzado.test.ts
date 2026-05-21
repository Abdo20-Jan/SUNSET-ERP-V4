import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 4.6 — anulación reversible del despacho cruzado + eliminación de borrador
// cruzado. Verifica que la reversión devuelve los counters de ItemContenedor
// (cantidadDespachada → cantidadDisponible), revierte el stock DF→destino,
// anula el asiento (con gate de período abierto, P0-2) y que todo es atómico:
// si el período está cerrado, NADA cambia.

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
  anularDespachoAction,
  contabilizarDespachoAction,
  eliminarDespachoAction,
} from "@/lib/actions/despachos";

const FECHA = new Date("2025-06-15T12:00:00.000Z");

describe("anulación / eliminación despacho cruzado (PR 4.6)", () => {
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
      "LineaAsiento",
      "Asiento",
      "MovimientoStock",
      "Transferencia",
      "StockPorDeposito",
      "VepDespacho",
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
    icId: number;
    depFiscalId: string;
    depDestinoId: string;
    productoId: string;
  }

  // Contenedor con 60 desconsolidadas: 30 ya despachadas (counter) + 30 libres.
  // Stock 60 en el DF. Despacho cruzado BORRADOR por esas 30.
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
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
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
        // estado post-materialización: 30 despachadas, 30 disponibles.
        cantidadDisponible: 30,
        cantidadDespachada: 30,
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
    // Movimiento de ingreso al DF que la desconsolidación crea en la vida
    // real — respalda el stock del DF para que el recalc de la reversión lo
    // reconstruya (60) en vez de dejarlo fantasma.
    await db.prisma.movimientoStock.create({
      data: {
        productoId: prod.id,
        depositoId: depFiscal.id,
        tipo: "INGRESO",
        cantidad: 60,
        costoUnitario: "12500.00",
        fecha: new Date("2025-06-10T12:00:00.000Z"),
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
    return {
      despachoId: despacho.id,
      icId: ic.id,
      depFiscalId: depFiscal.id,
      depDestinoId: depDestino.id,
      productoId: prod.id,
    };
  }

  it("anula un despacho cruzado contabilizado: revierte counters, stock DF→destino y asiento", async () => {
    const s = await seed();
    const contab = await contabilizarDespachoAction(s.despachoId);
    expect(contab.ok).toBe(true);

    // Pre-condición: stock movido y counters intactos en despachada.
    const spdDestinoPre = await db.prisma.stockPorDeposito.findUniqueOrThrow({
      where: { productoId_depositoId: { productoId: s.productoId, depositoId: s.depDestinoId } },
    });
    expect(spdDestinoPre.cantidadFisica).toBe(30);

    const res = await anularDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    expect(despacho.estado).toBe("ANULADO");

    // Asiento ANULADO.
    if (despacho.asientoId) {
      const asiento = await db.prisma.asiento.findUniqueOrThrow({
        where: { id: despacho.asientoId },
      });
      expect(asiento.estado).toBe("ANULADO");
    }

    // Counters revertidos: despachada 30→0, disponible 30→60.
    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icId } });
    expect(ic.cantidadDespachada).toBe(0);
    expect(ic.cantidadDisponible).toBe(60);

    // Stock revertido: DF vuelve a 60, destino vuelve a 0.
    const spdDF = await db.prisma.stockPorDeposito.findUniqueOrThrow({
      where: { productoId_depositoId: { productoId: s.productoId, depositoId: s.depFiscalId } },
    });
    expect(spdDF.cantidadFisica).toBe(60);
    const spdDestino = await db.prisma.stockPorDeposito.findUnique({
      where: { productoId_depositoId: { productoId: s.productoId, depositoId: s.depDestinoId } },
    });
    expect(spdDestino?.cantidadFisica ?? 0).toBe(0);

    // VEP eliminado.
    const vep = await db.prisma.vepDespacho.findUnique({ where: { despachoId: s.despachoId } });
    expect(vep).toBeNull();
  });

  it("anula un despacho cruzado en BORRADOR (sin asiento): sólo revierte counters", async () => {
    const s = await seed();
    const res = await anularDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    expect(despacho.estado).toBe("ANULADO");
    expect(despacho.asientoId).toBeNull();

    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icId } });
    expect(ic.cantidadDespachada).toBe(0);
    expect(ic.cantidadDisponible).toBe(60);
  });

  it("período cerrado: rechaza la anulación y deja counters/stock intactos (atómico)", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);

    await db.prisma.periodoContable.update({
      where: { codigo: "2025-06" },
      data: { estado: "CERRADO" },
    });

    const res = await anularDespachoAction(s.despachoId);
    expect(res.ok).toBe(false);

    // Rollback total: counters siguen en despachada, despacho CONTABILIZADO.
    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icId } });
    expect(ic.cantidadDespachada).toBe(30);
    expect(ic.cantidadDisponible).toBe(30);
    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    expect(despacho.estado).toBe("CONTABILIZADO");
    const spdDestino = await db.prisma.stockPorDeposito.findUniqueOrThrow({
      where: { productoId_depositoId: { productoId: s.productoId, depositoId: s.depDestinoId } },
    });
    expect(spdDestino.cantidadFisica).toBe(30);
  });

  it("elimina un borrador cruzado: revierte counters y borra el despacho", async () => {
    const s = await seed();
    const res = await eliminarDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const despacho = await db.prisma.despacho.findUnique({ where: { id: s.despachoId } });
    expect(despacho).toBeNull();

    const ic = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icId } });
    expect(ic.cantidadDespachada).toBe(0);
    expect(ic.cantidadDisponible).toBe(60);
  });

  it("rechaza anular un despacho ya anulado", async () => {
    const s = await seed();
    await anularDespachoAction(s.despachoId);
    const res = await anularDespachoAction(s.despachoId);
    expect(res.ok).toBe(false);
  });
});
