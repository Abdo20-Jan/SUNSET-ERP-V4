import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 4.5 — contabilización del despacho parcial CRUZADO (E2E vía action).
// Verifica el asiento NACIONALIZACION_VIA_DF (DEBE 1.1.7.01 / HABER 1.1.7.03
// con costo landed = costoFCUnitario×cant×TC) + tributos, el movimiento de
// stock DF→destino (aplicarNacionalizacionDF) y el VEP 1:1, todo en la misma
// transacción de contabilizarDespachoAction (fork por itemContenedorId).

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

describe("contabilización despacho cruzado (PR 4.5)", () => {
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
    depFiscalId: string;
    depDestinoId: string;
    productoId: string;
  }

  // Custo FC 12.50 USD × TC 1000 × 30 = 375000 ARS (nacionalizado).
  // DIE 100 USD × TC 1000 = 100000 ARS (tributo). Total asiento = 475000.
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
      depFiscalId: depFiscal.id,
      depDestinoId: depDestino.id,
      productoId: prod.id,
    };
  }

  it("genera asiento DF (1.1.7.01/1.1.7.03 + tributos), mueve stock DF→destino y crea VEP", async () => {
    const s = await seed();
    const res = await contabilizarDespachoAction(s.despachoId);
    expect(res.ok).toBe(true);

    const despacho = await db.prisma.despacho.findUniqueOrThrow({ where: { id: s.despachoId } });
    expect(despacho.estado).toBe("CONTABILIZADO");
    expect(despacho.asientoId).not.toBeNull();

    // Asiento: líneas por código de cuenta.
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: despacho.asientoId! },
      include: { cuenta: { select: { codigo: true } } },
    });
    const debePorCuenta = new Map<string, string>();
    const haberPorCuenta = new Map<string, string>();
    for (const l of lineas) {
      if (l.debe.gt(0)) debePorCuenta.set(l.cuenta.codigo, l.debe.toFixed(2));
      if (l.haber.gt(0)) haberPorCuenta.set(l.cuenta.codigo, l.haber.toFixed(2));
    }
    // Nacionalización CON CAPITALIZACIÓN del DIE en el costo de la mercadería:
    //   DEBE 1.1.7.01 = nacionalizado 375000 + DIE capitalizado 100000 = 475000.
    //   HABER 1.1.7.03 = sólo el costo FC nacionalizado (sin tributos) = 375000.
    expect(debePorCuenta.get("1.1.7.01")).toBe("475000.00");
    expect(haberPorCuenta.get("1.1.7.03")).toBe("375000.00");
    // El DIE YA NO va a egreso 5.7.1.01 (capitalizado en 1.1.7.01); el HABER
    // del pasivo aduanero (2.1.5.01) permanece como obligación a pagar.
    expect(debePorCuenta.has("5.7.1.01")).toBe(false);
    expect(haberPorCuenta.get("2.1.3.4.01")).toBe("100000.00");
    const totalDebe = lineas.reduce((s2, l) => s2 + Number(l.debe), 0);
    const totalHaber = lineas.reduce((s2, l) => s2 + Number(l.haber), 0);
    expect(totalDebe).toBeCloseTo(totalHaber, 2); // asiento balanceado
    expect(totalDebe).toBeCloseTo(475000, 2); // 375000 nacionalización + 100000 DIE

    // ItemDespacho.costoUnitario = costo landed = (375000 + 100000) / 30.
    const items = await db.prisma.itemDespacho.findMany({ where: { despachoId: s.despachoId } });
    expect(items[0]?.costoUnitario.toFixed(2)).toBe("15833.33");

    // Stock movido DF → destino.
    const spdDF = await db.prisma.stockPorDeposito.findUniqueOrThrow({
      where: { productoId_depositoId: { productoId: s.productoId, depositoId: s.depFiscalId } },
    });
    const spdDestino = await db.prisma.stockPorDeposito.findUniqueOrThrow({
      where: { productoId_depositoId: { productoId: s.productoId, depositoId: s.depDestinoId } },
    });
    expect(spdDF.cantidadFisica).toBe(30); // 60 - 30
    expect(spdDestino.cantidadFisica).toBe(30);

    // VEP 1:1 con la suma de tributos (DIE 100 × TC 1000).
    const vep = await db.prisma.vepDespacho.findUniqueOrThrow({
      where: { despachoId: s.despachoId },
    });
    expect(vep.montoTotal.toFixed(2)).toBe("100000.00");
  });

  it("rechaza si el despacho ya está CONTABILIZADO (doble contabilización)", async () => {
    const s = await seed();
    await contabilizarDespachoAction(s.despachoId);
    const res = await contabilizarDespachoAction(s.despachoId);
    expect(res.ok).toBe(false);
  });
});
