import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 4.1 — fork legacy/nuevo en crearDespachoAction (P1-5).
// Regresión: con la flag APAGADA el comportamiento legacy queda idéntico;
// con la flag ENCENDIDA se enruta al stub del flujo por contenedor (Fase 4).

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
          // Forwarding genérico al client: tipamos como record para evitar `any`.
          const target = client as unknown as
            | Record<string | symbol, unknown>
            | undefined;
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { crearDespachoAction } from "@/lib/actions/despachos";

const FECHA = new Date("2025-06-15T12:00:00.000Z");

describe("fork despacho legacy/contenedor (PR 4.1)", () => {
  let db: TestDb;
  let embarqueId: string;
  let itemEmbarqueId: number;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "false";

    await db.reset([
      "ItemDespacho",
      "Despacho",
      "ItemEmbarque",
      "Embarque",
      "Asiento",
      "PeriodoContable",
      "Producto",
      "Proveedor",
    ]);

    const prov = await db.prisma.proveedor.create({ data: { nombre: "Proveedor Test" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "P-A", nombre: "Neumático A" },
    });
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
    // El gate legacy exige asientoZonaPrimariaId (zona primaria confirmada).
    const asientoZp = await db.prisma.asiento.create({
      data: {
        numero: 1,
        fecha: FECHA,
        descripcion: "Zona primaria",
        origen: "COMEX",
        totalDebe: "0",
        totalHaber: "0",
        periodoId: periodo.id,
      },
    });
    const emb = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-001",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        asientoZonaPrimariaId: asientoZp.id,
        items: { create: [{ productoId: prod.id, cantidad: 100, precioUnitarioFob: "10.00" }] },
      },
    });
    embarqueId = emb.id;
    const ie = await db.prisma.itemEmbarque.findFirstOrThrow({ where: { embarqueId: emb.id } });
    itemEmbarqueId = ie.id;
  });

  it("flag OFF: ejecuta el flujo legacy y crea el despacho (regresión)", async () => {
    const res = await crearDespachoAction({
      embarqueId,
      fecha: FECHA.toISOString(),
      tipoCambio: "1000",
      items: [{ itemEmbarqueId, cantidad: 30 }],
    });
    expect(res.ok).toBe(true);

    const despachos = await db.prisma.despacho.findMany({ include: { items: true } });
    expect(despachos).toHaveLength(1);
    expect(despachos[0]?.items).toHaveLength(1);
    expect(despachos[0]?.items[0]?.cantidad).toBe(30);
  });

  it("flag OFF: preserva validación legacy (cantidad > remanente)", async () => {
    const res = await crearDespachoAction({
      embarqueId,
      fecha: FECHA.toISOString(),
      tipoCambio: "1000",
      items: [{ itemEmbarqueId, cantidad: 150 }], // > 100 del embarque
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/excede remanente/i);
    expect(await db.prisma.despacho.count()).toBe(0);
  });

  it("flag ON sin itemContenedorId: rechaza (requiere origen por contenedor), sin crear despacho", async () => {
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    const res = await crearDespachoAction({
      embarqueId,
      fecha: FECHA.toISOString(),
      tipoCambio: "1000",
      items: [{ itemEmbarqueId, cantidad: 30 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/origen por contenedor|itemContenedorId/i);
    expect(await db.prisma.despacho.count()).toBe(0);
  });

  it("flag ON con itemContenedorId: enruta al flujo cruzado y consume counters (PR 4.2)", async () => {
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    const ie = await db.prisma.itemEmbarque.findUniqueOrThrow({ where: { id: itemEmbarqueId } });
    const contenedor = await db.prisma.contenedor.create({
      data: { embarqueId, numeroContenedor: "MSCU0000001", estado: "DESCONSOLIDADO" },
    });
    const ic = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId,
        productoId: ie.productoId,
        cantidadDeclarada: 60,
        cantidadFisica: 60,
        cantidadDisponible: 60,
      },
    });

    const res = await crearDespachoAction({
      embarqueId,
      fecha: FECHA.toISOString(),
      tipoCambio: "1000",
      items: [{ itemEmbarqueId, cantidad: 30, itemContenedorId: ic.id }],
    });
    expect(res.ok).toBe(true);

    const despachos = await db.prisma.despacho.findMany({ include: { items: true } });
    expect(despachos).toHaveLength(1);
    expect(despachos[0]?.items[0]).toMatchObject({
      itemContenedorId: ic.id,
      contenedorId: contenedor.id,
      cantidad: 30,
    });

    const actualizado = await db.prisma.itemContenedor.findUniqueOrThrow({ where: { id: ic.id } });
    expect(actualizado.cantidadDisponible).toBe(30); // 60 - 30 (fuente DIRECTO)
    expect(actualizado.cantidadDespachada).toBe(30);
  });
});
