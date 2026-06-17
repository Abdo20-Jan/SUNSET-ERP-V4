import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./db";

// PR schema ItemDespacho cruzado — verifica los índices UNIQUE PARCIALES +
// CHECK (decisión 2026-05-21, Abordagem A+F). Ahora vienen del baseline
// 0_init que `createTestDb` aplica vía `migrate deploy` (si no, estos
// tests darían falso-positivo).

const TABLAS = [
  "ItemDespacho",
  "Despacho",
  "ItemContenedor",
  "Contenedor",
  "ItemEmbarque",
  "Embarque",
  "Producto",
  "Proveedor",
] as const;

interface Seed {
  despachoId: string;
  itemEmbarqueId: number;
  contenedorId: string;
  itemContenedorA: number;
  itemContenedorB: number;
}

describe("ItemDespacho — índices parciales + CHECK (esquema cruzado)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset(TABLAS);
  });

  async function seed(): Promise<Seed> {
    const proveedor = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const producto = await db.prisma.producto.create({
      data: { codigo: "SKU-1", nombre: "Neumático" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-IDQ",
        proveedorId: proveedor.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
      },
    });
    const itemEmbarque = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: producto.id,
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });
    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: "DESP-1",
        embarqueId: embarque.id,
        fecha: new Date("2025-06-15T12:00:00.000Z"),
      },
    });
    const contenedor = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU0000001" },
    });
    // Lotes distintos: prod tiene UNIQUE parcial (contenedor, producto) WHERE
    // loteFabricacion IS NULL — dos filas del mismo producto sin lote violarían
    // ItemContenedor_cp_null_idx. Dos lotes representan "dos fuentes" válidas.
    const icA = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        productoId: producto.id,
        loteFabricacion: "LOTE-A",
        cantidadDeclarada: 60,
      },
    });
    const icB = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        productoId: producto.id,
        loteFabricacion: "LOTE-B",
        cantidadDeclarada: 40,
      },
    });
    return {
      despachoId: despacho.id,
      itemEmbarqueId: itemEmbarque.id,
      contenedorId: contenedor.id,
      itemContenedorA: icA.id,
      itemContenedorB: icB.id,
    };
  }

  describe("legacy (contenedorId IS NULL)", () => {
    it("rechaza dos líneas legacy con el mismo (despacho, itemEmbarque)", async () => {
      const s = await seed();
      await db.prisma.itemDespacho.create({
        data: { despachoId: s.despachoId, itemEmbarqueId: s.itemEmbarqueId, cantidad: 10 },
      });
      await expect(
        db.prisma.itemDespacho.create({
          data: { despachoId: s.despachoId, itemEmbarqueId: s.itemEmbarqueId, cantidad: 5 },
        }),
      ).rejects.toThrow();
    });
  });

  describe("cruzado (contenedorId IS NOT NULL)", () => {
    it("permite N líneas del mismo itemEmbarque desde itemContenedores distintos", async () => {
      const s = await seed();
      await db.prisma.itemDespacho.create({
        data: {
          despachoId: s.despachoId,
          itemEmbarqueId: s.itemEmbarqueId,
          contenedorId: s.contenedorId,
          itemContenedorId: s.itemContenedorA,
          cantidad: 30,
        },
      });
      // mismo itemEmbarque, otro itemContenedor → permitido (no rompe el legacy_uq).
      const segunda = await db.prisma.itemDespacho.create({
        data: {
          despachoId: s.despachoId,
          itemEmbarqueId: s.itemEmbarqueId,
          contenedorId: s.contenedorId,
          itemContenedorId: s.itemContenedorB,
          cantidad: 25,
        },
      });
      expect(segunda.id).toBeGreaterThan(0);
      expect(await db.prisma.itemDespacho.count({ where: { despachoId: s.despachoId } })).toBe(2);
    });

    it("rechaza dos líneas con el mismo (despacho, itemContenedor)", async () => {
      const s = await seed();
      await db.prisma.itemDespacho.create({
        data: {
          despachoId: s.despachoId,
          itemEmbarqueId: s.itemEmbarqueId,
          contenedorId: s.contenedorId,
          itemContenedorId: s.itemContenedorA,
          cantidad: 30,
        },
      });
      await expect(
        db.prisma.itemDespacho.create({
          data: {
            despachoId: s.despachoId,
            itemEmbarqueId: s.itemEmbarqueId,
            contenedorId: s.contenedorId,
            itemContenedorId: s.itemContenedorA,
            cantidad: 1,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("CHECK de coherencia", () => {
    it("rechaza una línea medio-llena (contenedorId sin itemContenedorId)", async () => {
      const s = await seed();
      await expect(
        db.prisma.itemDespacho.create({
          data: {
            despachoId: s.despachoId,
            itemEmbarqueId: s.itemEmbarqueId,
            contenedorId: s.contenedorId,
            cantidad: 10,
          },
        }),
      ).rejects.toThrow();
    });

    it("rechaza una línea medio-llena (itemContenedorId sin contenedorId)", async () => {
      const s = await seed();
      await expect(
        db.prisma.itemDespacho.create({
          data: {
            despachoId: s.despachoId,
            itemEmbarqueId: s.itemEmbarqueId,
            itemContenedorId: s.itemContenedorA,
            cantidad: 10,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
