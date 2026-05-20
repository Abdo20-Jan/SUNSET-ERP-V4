import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  actualizarPackingList,
  crearContenedor,
  eliminarContenedor,
  validarInvariantePackingList,
} from "@/lib/services/contenedor";
import { createTestDb, type TestDb } from "./db";

// PR 2.1 — service de contenedores: CRUD + bloqueo optimista + invariante Σ.
// Pasamos el client del contenedor como `tx` para enrutar a la BD efímera
// (el singleton `db` apuntaría a otra base). Es estructuralmente un TxClient.

describe("service contenedor (PR 2.1)", () => {
  let db: TestDb;
  let embarqueId: string;
  let productoA: string;
  let productoB: string;

  const crear: typeof crearContenedor = (i) => crearContenedor(i, db.prisma);
  const actualizar: typeof actualizarPackingList = (id, items, v) =>
    actualizarPackingList(id, items, v, db.prisma);
  const eliminar: typeof eliminarContenedor = (id) => eliminarContenedor(id, db.prisma);
  const validar: typeof validarInvariantePackingList = (id) =>
    validarInvariantePackingList(id, db.prisma);

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Producto",
      "Proveedor",
    ]);

    const prov = await db.prisma.proveedor.create({ data: { nombre: "Proveedor Test" } });
    const pa = await db.prisma.producto.create({ data: { codigo: "P-A", nombre: "Neumático A" } });
    const pb = await db.prisma.producto.create({ data: { codigo: "P-B", nombre: "Neumático B" } });
    productoA = pa.id;
    productoB = pb.id;

    const emb = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-001",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        items: {
          create: [
            { productoId: pa.id, cantidad: 100, precioUnitarioFob: "10.00" },
            { productoId: pb.id, cantidad: 40, precioUnitarioFob: "20.00" },
          ],
        },
      },
    });
    embarqueId = emb.id;
  });

  describe("crearContenedor", () => {
    it("crea contenedor con items y counters en 0", async () => {
      const cont = await crear({
        embarqueId,
        numeroContenedor: "MSCU1234567",
        items: [{ productoId: productoA, cantidadDeclarada: 60 }],
      });
      expect(cont.estado).toBe("BORRADOR");

      const items = await db.prisma.itemContenedor.findMany({ where: { contenedorId: cont.id } });
      expect(items).toHaveLength(1);
      expect(items[0]?.cantidadDeclarada).toBe(60);
      expect(items[0]?.cantidadDisponible).toBe(0);
      expect(items[0]?.cantidadEnDespacho).toBe(0);
      expect(items[0]?.cantidadDespachada).toBe(0);
      expect(items[0]?.itemEmbarqueId).not.toBeNull();
    });

    it("rechaza cantidadDeclarada <= 0", async () => {
      await expect(
        crear({
          embarqueId,
          numeroContenedor: "C1",
          items: [{ productoId: productoA, cantidadDeclarada: 0 }],
        }),
      ).rejects.toMatchObject({ code: "CANTIDAD_INVALIDA" });
    });

    it("rechaza producto que no pertenece al embarque", async () => {
      const otro = await db.prisma.producto.create({ data: { codigo: "P-X", nombre: "Ajeno" } });
      await expect(
        crear({
          embarqueId,
          numeroContenedor: "C1",
          items: [{ productoId: otro.id, cantidadDeclarada: 5 }],
        }),
      ).rejects.toMatchObject({ code: "PRODUCTO_FUERA_DE_EMBARQUE" });
    });

    it("rechaza embarque inexistente", async () => {
      await expect(
        crear({ embarqueId: "no-existe", numeroContenedor: "C1" }),
      ).rejects.toMatchObject({ code: "EMBARQUE_INEXISTENTE" });
    });
  });

  describe("validarInvariantePackingList", () => {
    it("ok=true cuando Σ declarada == ItemEmbarque.cantidad para todos", async () => {
      // A: 100 = 60 + 40 (dos contenedores). B: 40 = 40.
      await crear({
        embarqueId,
        numeroContenedor: "C1",
        items: [
          { productoId: productoA, cantidadDeclarada: 60 },
          { productoId: productoB, cantidadDeclarada: 40 },
        ],
      });
      await crear({
        embarqueId,
        numeroContenedor: "C2",
        items: [{ productoId: productoA, cantidadDeclarada: 40 }],
      });

      const res = await validar(embarqueId);
      expect(res.ok).toBe(true);
      expect(res.diffs).toHaveLength(0);
      expect(res.productos).toHaveLength(2);
    });

    it("ok=false con diff cuando falta declarar", async () => {
      await crear({
        embarqueId,
        numeroContenedor: "C1",
        items: [{ productoId: productoA, cantidadDeclarada: 60 }], // faltan 40 de A y 40 de B
      });
      const res = await validar(embarqueId);
      expect(res.ok).toBe(false);
      const a = res.productos.find((p) => p.productoId === productoA);
      expect(a).toMatchObject({ declarado: 60, esperado: 100, diferencia: -40 });
      const b = res.productos.find((p) => p.productoId === productoB);
      expect(b).toMatchObject({ declarado: 0, esperado: 40, diferencia: -40 });
      expect(res.diffs).toHaveLength(2);
    });

    it("detecta sobre-declaración (diferencia positiva)", async () => {
      await crear({
        embarqueId,
        numeroContenedor: "C1",
        items: [
          { productoId: productoA, cantidadDeclarada: 120 },
          { productoId: productoB, cantidadDeclarada: 40 },
        ],
      });
      const res = await validar(embarqueId);
      expect(res.ok).toBe(false);
      expect(res.productos.find((p) => p.productoId === productoA)?.diferencia).toBe(20);
    });
  });

  describe("actualizarPackingList (bloqueo optimista)", () => {
    it("happy path: reemplaza items e incrementa version", async () => {
      const cont = await crear({
        embarqueId,
        numeroContenedor: "C1",
        items: [{ productoId: productoA, cantidadDeclarada: 10 }],
      });

      const upd = await actualizar(
        cont.id,
        [
          { productoId: productoA, cantidadDeclarada: 50 },
          { productoId: productoB, cantidadDeclarada: 40 },
        ],
        cont.updatedAt,
      );
      expect(upd.updatedAt.getTime()).toBeGreaterThanOrEqual(cont.updatedAt.getTime());

      const items = await db.prisma.itemContenedor.findMany({
        where: { contenedorId: cont.id },
        orderBy: { id: "asc" },
      });
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.cantidadDeclarada)).toEqual([50, 40]);
    });

    it("version desactualizada → CONCURRENCIA", async () => {
      const cont = await crear({
        embarqueId,
        numeroContenedor: "C1",
        items: [{ productoId: productoA, cantidadDeclarada: 10 }],
      });
      await expect(
        actualizar(
          cont.id,
          [{ productoId: productoA, cantidadDeclarada: 20 }],
          new Date(cont.updatedAt.getTime() - 1000), // token viejo
        ),
      ).rejects.toMatchObject({ code: "CONCURRENCIA" });
    });

    it("contenedor en EN_DEPOSITO_FISCAL → ESTADO_NO_EDITABLE", async () => {
      const cont = await crear({
        embarqueId,
        numeroContenedor: "C1",
        items: [{ productoId: productoA, cantidadDeclarada: 10 }],
      });
      await db.prisma.contenedor.update({
        where: { id: cont.id },
        data: { estado: "EN_DEPOSITO_FISCAL" },
      });
      await expect(
        actualizar(cont.id, [{ productoId: productoA, cantidadDeclarada: 20 }], cont.updatedAt),
      ).rejects.toMatchObject({ code: "ESTADO_NO_EDITABLE" });
    });

    it("packing list vacío → PACKING_LIST_VACIO", async () => {
      const cont = await crear({
        embarqueId,
        numeroContenedor: "C1",
        items: [{ productoId: productoA, cantidadDeclarada: 10 }],
      });
      await expect(actualizar(cont.id, [], cont.updatedAt)).rejects.toMatchObject({
        code: "PACKING_LIST_VACIO",
      });
    });
  });

  describe("eliminarContenedor", () => {
    it("elimina en estado editable", async () => {
      const cont = await crear({ embarqueId, numeroContenedor: "C1" });
      await eliminar(cont.id);
      expect(await db.prisma.contenedor.count()).toBe(0);
    });

    it("rechaza eliminar si ya está desconsolidado", async () => {
      const cont = await crear({ embarqueId, numeroContenedor: "C1" });
      await db.prisma.contenedor.update({
        where: { id: cont.id },
        data: { estado: "DESCONSOLIDADO" },
      });
      await expect(eliminar(cont.id)).rejects.toMatchObject({ code: "ESTADO_NO_EDITABLE" });
    });
  });
});
