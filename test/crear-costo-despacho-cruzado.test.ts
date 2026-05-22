import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Costo extra de nacionalización inline en el despacho cruzado.
// `crearCostoDespachoCruzadoAction` crea una factura EmbarqueCosto en BORRADOR
// con momento=DESPACHO, vinculada al embarque Y al despacho cruzado en
// BORRADOR, con N líneas (cuentaContableGastoId + subtotal). NO emite asiento:
// la capitalización ocurre al contabilizar el despacho (otro flujo).

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

import { crearCostoDespachoCruzadoAction } from "@/lib/actions/despacho-cruzado-costos";

const FECHA = new Date("2025-06-15T12:00:00.000Z");

// Contador determinístico para identificadores únicos (sin Math.random — crítico
// para Codacy).
let seq = 0;
const nextSeq = () => ++seq;

describe("crearCostoDespachoCruzadoAction", () => {
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
    cuentaGastoId: number;
    /** Despacho NO cruzado (sin itemContenedorId), para el caso negativo. */
    despachoLegacyId: string;
  }

  async function seed(): Promise<Seed> {
    const n = nextSeq();
    const prov = await db.prisma.proveedor.create({
      data: { nombre: `Despachante SA ${n}` },
    });
    const cuentaGasto = await db.prisma.cuentaContable.create({
      data: {
        codigo: `5.1.${n}`,
        nombre: `Honorarios despachante ${n}`,
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
        activa: true,
      },
    });
    const prod = await db.prisma.producto.create({
      data: { codigo: `SKU-${n}`, nombre: "Neumático" },
    });
    const depFiscal = await db.prisma.deposito.create({
      data: { nombre: `DF Aduana ${n}`, tipo: "ZONA_PRIMARIA" },
    });
    const depDestino = await db.prisma.deposito.create({
      data: { nombre: `Nacional ${n}`, tipo: "NACIONAL" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: `EMB-${n}`,
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
        numeroContenedor: `MSCU000000${n}`,
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
    // Despacho cruzado en BORRADOR (línea con itemContenedorId).
    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: `EMB-${n}-D1`,
        embarqueId: embarque.id,
        fecha: FECHA,
        estado: "BORRADOR",
        tipoCambio: "1000.000000",
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
    // Despacho NO cruzado (línea sin itemContenedorId) para el caso negativo.
    const despachoLegacy = await db.prisma.despacho.create({
      data: {
        codigo: `EMB-${n}-D2`,
        embarqueId: embarque.id,
        fecha: FECHA,
        estado: "BORRADOR",
        tipoCambio: "1000.000000",
        items: { create: [{ itemEmbarqueId: itemEmbarque.id, cantidad: 10 }] },
      },
    });
    return {
      embarqueId: embarque.id,
      despachoId: despacho.id,
      proveedorId: prov.id,
      cuentaGastoId: cuentaGasto.id,
      despachoLegacyId: despachoLegacy.id,
    };
  }

  it("crea EmbarqueCosto BORRADOR momento=DESPACHO linkado al despacho con sus líneas", async () => {
    const s = await seed();

    const res = await crearCostoDespachoCruzadoAction({
      despachoId: s.despachoId,
      proveedorId: s.proveedorId,
      moneda: "USD",
      tipoCambio: "1000",
      facturaNumero: "F-DESP-001",
      iva: "21.00",
      iibb: "3.50",
      otros: "0",
      lineas: [
        {
          tipo: "HONORARIOS_DESPACHANTE",
          cuentaContableGastoId: s.cuentaGastoId,
          descripcion: "Honorarios despachante",
          subtotal: "100.00",
        },
        {
          tipo: "GASTOS_EXTRAS",
          cuentaContableGastoId: s.cuentaGastoId,
          subtotal: "25.50",
        },
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const costo = await db.prisma.embarqueCosto.findUniqueOrThrow({
      where: { id: res.embarqueCostoId },
      include: { lineas: { orderBy: { id: "asc" } } },
    });
    expect(costo.momento).toBe("DESPACHO");
    expect(costo.estado).toBe("BORRADOR");
    expect(costo.despachoId).toBe(s.despachoId);
    expect(costo.embarqueId).toBe(s.embarqueId);
    expect(costo.proveedorId).toBe(s.proveedorId);
    expect(costo.facturaNumero).toBe("F-DESP-001");
    expect(costo.tipoCambio.toFixed(2)).toBe("1000.00");
    expect(costo.iva.toFixed(2)).toBe("21.00");
    expect(costo.iibb.toFixed(2)).toBe("3.50");
    expect(costo.asientoId).toBeNull(); // NO se emitió asiento.

    expect(costo.lineas).toHaveLength(2);
    expect(costo.lineas[0].subtotal.toFixed(2)).toBe("100.00");
    expect(costo.lineas[0].tipo).toBe("HONORARIOS_DESPACHANTE");
    expect(costo.lineas[0].cuentaContableGastoId).toBe(s.cuentaGastoId);
    expect(costo.lineas[0].descripcion).toBe("Honorarios despachante");
    expect(costo.lineas[1].subtotal.toFixed(2)).toBe("25.50");
    expect(costo.lineas[1].descripcion).toBeNull();
  });

  it("no emite asiento (no crea Asiento ni LineaAsiento)", async () => {
    const s = await seed();
    const res = await crearCostoDespachoCruzadoAction({
      despachoId: s.despachoId,
      proveedorId: s.proveedorId,
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [{ cuentaContableGastoId: s.cuentaGastoId, subtotal: "50.00" }],
    });
    expect(res.ok).toBe(true);
    const asientos = await db.prisma.asiento.count();
    expect(asientos).toBe(0);
  });

  it("rechaza proveedor inexistente", async () => {
    const s = await seed();
    const res = await crearCostoDespachoCruzadoAction({
      despachoId: s.despachoId,
      proveedorId: "00000000-0000-0000-0000-000000000000",
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [{ cuentaContableGastoId: s.cuentaGastoId, subtotal: "50.00" }],
    });
    expect(res.ok).toBe(false);
  });

  it("rechaza sin líneas", async () => {
    const s = await seed();
    const res = await crearCostoDespachoCruzadoAction({
      despachoId: s.despachoId,
      proveedorId: s.proveedorId,
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [],
    });
    expect(res.ok).toBe(false);
  });

  it("rechaza TC <= 0", async () => {
    const s = await seed();
    const res = await crearCostoDespachoCruzadoAction({
      despachoId: s.despachoId,
      proveedorId: s.proveedorId,
      moneda: "USD",
      tipoCambio: "0",
      lineas: [{ cuentaContableGastoId: s.cuentaGastoId, subtotal: "50.00" }],
    });
    expect(res.ok).toBe(false);
  });

  it("rechaza despacho NO cruzado (sin itemContenedorId)", async () => {
    const s = await seed();
    const res = await crearCostoDespachoCruzadoAction({
      despachoId: s.despachoLegacyId,
      proveedorId: s.proveedorId,
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [{ cuentaContableGastoId: s.cuentaGastoId, subtotal: "50.00" }],
    });
    expect(res.ok).toBe(false);
  });

  it("rechaza despacho ya CONTABILIZADO", async () => {
    const s = await seed();
    await db.prisma.despacho.update({
      where: { id: s.despachoId },
      data: { estado: "CONTABILIZADO" },
    });
    const res = await crearCostoDespachoCruzadoAction({
      despachoId: s.despachoId,
      proveedorId: s.proveedorId,
      moneda: "USD",
      tipoCambio: "1000",
      lineas: [{ cuentaContableGastoId: s.cuentaGastoId, subtotal: "50.00" }],
    });
    expect(res.ok).toBe(false);
  });
});
