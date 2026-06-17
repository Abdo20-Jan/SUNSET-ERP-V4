import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 4.4a — actions del borrador de despacho cruzado + READ de la matriz +
// transición de estado del Contenedor (A0). Cubre: gate (flag+auth),
// crearBorradorAction (traba counters), obtenerMatrizDespachoCruzado (DTO +
// borradorVigente), contabilizarBorradorAction (materializa + mueve counters +
// PARCIALMENTE/TOTALMENTE_DESPACHADO) y expirarBorradorAction (libera counters).

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
  contabilizarBorradorAction,
  crearBorradorAction,
  expirarBorradorAction,
} from "@/lib/actions/despachos";
import { obtenerMatrizDespachoCruzado } from "@/lib/services/despacho-parcial";

const FECHA = new Date("2025-06-15T12:00:00.000Z");

describe("actions despacho cruzado / borrador (PR 4.4a)", () => {
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
      "ItemDespacho",
      "Despacho",
      "DespachoBorrador",
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Producto",
      "Proveedor",
    ]);
  });

  interface Seed {
    embarqueId: string;
    contenedorId: string;
    icA: number; // disponible 60
    icB: number; // disponible 40
  }

  async function seed(): Promise<Seed> {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "SKU-1", nombre: "Neumático" },
    });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: "EMB-CR", proveedorId: prov.id, moneda: "USD", tipoCambio: "1000.000000" },
    });
    const ie = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prod.id,
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU0000001", estado: "DESCONSOLIDADO" },
    });
    // Lotes distintos: evita violar ItemContenedor_cp_null_idx (UNIQUE parcial
    // de prod sobre (contenedor, producto) WHERE loteFabricacion IS NULL).
    const icA = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: ie.id,
        productoId: prod.id,
        loteFabricacion: "LOTE-A",
        cantidadDeclarada: 60,
        cantidadFisica: 60,
        cantidadDisponible: 60,
        costoFCUnitario: "12.5000",
      },
    });
    const icB = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: ie.id,
        productoId: prod.id,
        loteFabricacion: "LOTE-B",
        cantidadDeclarada: 40,
        cantidadFisica: 40,
        cantidadDisponible: 40,
        costoFCUnitario: "12.5000",
      },
    });
    return { embarqueId: embarque.id, contenedorId: contenedor.id, icA: icA.id, icB: icB.id };
  }

  it("gate: con la flag OFF rechaza crearBorradorAction", async () => {
    const s = await seed();
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "false";
    const res = await crearBorradorAction({
      embarqueId: s.embarqueId,
      lineas: [{ itemContenedorId: s.icA, cantidad: 10 }],
    });
    expect(res.ok).toBe(false);
  });

  it("crearBorradorAction traba counters (disponible→enDespacho) sin tocar el estado del contenedor", async () => {
    const s = await seed();
    const res = await crearBorradorAction({
      embarqueId: s.embarqueId,
      lineas: [{ itemContenedorId: s.icA, cantidad: 30 }],
    });
    expect(res.ok).toBe(true);

    const icA = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icA } });
    expect(icA.cantidadDisponible).toBe(30);
    expect(icA.cantidadEnDespacho).toBe(30);
    // Borrador (enDespacho) todavía no despacha → contenedor sigue DESCONSOLIDADO.
    const cont = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    expect(cont.estado).toBe("DESCONSOLIDADO");
  });

  it("obtenerMatrizDespachoCruzado devuelve SKUs/celdas y el borrador vigente del usuario", async () => {
    const s = await seed();
    await crearBorradorAction({
      embarqueId: s.embarqueId,
      lineas: [{ itemContenedorId: s.icA, cantidad: 30 }],
    });
    const matriz = await obtenerMatrizDespachoCruzado(s.embarqueId, "user-uuid", db.prisma);
    expect(matriz).not.toBeNull();
    if (!matriz) throw new Error("sin matriz");
    expect(matriz.contenedores).toHaveLength(1);
    expect(matriz.skus).toHaveLength(1);
    // Dos celdas (icA con 30 restantes, icB con 40), una por contenedor-línea.
    const celdas = matriz.skus[0]!.celdas;
    const disponiblePorIc = new Map(celdas.map((c) => [c.itemContenedorId, c.cantidadDisponible]));
    expect(disponiblePorIc.get(s.icA)).toBe(30);
    expect(disponiblePorIc.get(s.icB)).toBe(40);
    expect(matriz.borradorVigente?.lineas).toEqual([{ itemContenedorId: s.icA, cantidad: 30 }]);
  });

  it("contabilizarBorradorAction materializa, mueve enDespacho→despachada y deja PARCIALMENTE_DESPACHADO", async () => {
    const s = await seed();
    const crear = await crearBorradorAction({
      embarqueId: s.embarqueId,
      lineas: [{ itemContenedorId: s.icA, cantidad: 30 }],
    });
    if (!crear.ok) throw new Error("no creó");

    const res = await contabilizarBorradorAction({
      borradorId: crear.borradorId,
      embarqueId: s.embarqueId,
      fecha: FECHA,
    });
    expect(res.ok).toBe(true);

    const icA = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icA } });
    expect(icA.cantidadEnDespacho).toBe(0);
    expect(icA.cantidadDespachada).toBe(30);
    expect(icA.cantidadDisponible).toBe(30);

    const cont = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    expect(cont.estado).toBe("PARCIALMENTE_DESPACHADO");

    // El despacho materializado queda en BORRADOR (el asiento es contabilizarDespachoAction).
    const desp = await db.prisma.despacho.findFirstOrThrow({ where: { embarqueId: s.embarqueId } });
    expect(desp.estado).toBe("BORRADOR");
    // El borrador se consumió.
    const borrador = await db.prisma.despachoBorrador.findUnique({
      where: { id: crear.borradorId },
    });
    expect(borrador).toBeNull();
  });

  it("despachar todo el contenedor lo deja TOTALMENTE_DESPACHADO", async () => {
    const s = await seed();
    const crear = await crearBorradorAction({
      embarqueId: s.embarqueId,
      lineas: [
        { itemContenedorId: s.icA, cantidad: 60 },
        { itemContenedorId: s.icB, cantidad: 40 },
      ],
    });
    if (!crear.ok) throw new Error("no creó");
    const res = await contabilizarBorradorAction({
      borradorId: crear.borradorId,
      embarqueId: s.embarqueId,
      fecha: FECHA,
    });
    expect(res.ok).toBe(true);
    const cont = await db.prisma.contenedor.findUniqueOrThrow({ where: { id: s.contenedorId } });
    expect(cont.estado).toBe("TOTALMENTE_DESPACHADO");
  });

  it("expirarBorradorAction libera los counters (enDespacho→disponible)", async () => {
    const s = await seed();
    const crear = await crearBorradorAction({
      embarqueId: s.embarqueId,
      lineas: [{ itemContenedorId: s.icA, cantidad: 30 }],
    });
    if (!crear.ok) throw new Error("no creó");

    const res = await expirarBorradorAction({
      borradorId: crear.borradorId,
      embarqueId: s.embarqueId,
    });
    expect(res.ok).toBe(true);

    const icA = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: s.icA } });
    expect(icA.cantidadEnDespacho).toBe(0);
    expect(icA.cantidadDisponible).toBe(60);
    const borrador = await db.prisma.despachoBorrador.findUniqueOrThrow({
      where: { id: crear.borradorId },
    });
    expect(borrador.estadoActual).toBe("EXPIRADO");
  });
});
