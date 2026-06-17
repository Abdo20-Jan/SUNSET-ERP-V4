import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  contabilizarBorrador,
  crearBorrador,
  expirarBorrador,
  materializarDespachoCruzado,
  retomarBorrador,
} from "@/lib/services/despacho-parcial";
import { createTestDb, type TestDb } from "./db";

// PR 4.2 + 4.3 — service de despacho parcial cruzado + contrato del borrador.
// Cuatro verbos: crearBorrador (traba counters) / retomarBorrador (rechaza
// EXPIRADO, P0-4) / expirarBorrador (EXPIRADO antes de liberar, P0-4) /
// contabilizarBorrador (materializa Despacho + ItemDespacho cruzado, mueve
// counters enDespacho→despachada, SIN asiento — eso es 4.5). El traba de
// counters es single-shot (UPDATE condicional WHERE disponible >= ?, PR 4.3):
// el describe "traba single-shot concurrente" prueba que no hay oversell.

const TABLAS = [
  "ItemDespacho",
  "Despacho",
  "DespachoBorrador",
  "ItemContenedor",
  "Contenedor",
  "ItemEmbarque",
  "Embarque",
  "Producto",
  "Proveedor",
] as const;

interface Seed {
  embarqueId: string;
  itemEmbarqueId: number;
  contenedorId: string;
  itemContenedorA: number; // disponible 60
  itemContenedorB: number; // disponible 40
  /** ItemContenedor de OTRO embarque (para el caso AJENO). */
  itemContenedorAjeno: number;
  embarqueAjenoId: string;
}

describe("despacho-parcial — contrato del borrador (Fase 4 cruzada)", () => {
  let db: TestDb;

  // Inyectan el client del contenedor como `tx` (mismo patrón que
  // desconsolidacion.test.ts): el service corre contra la BD de prueba.
  const crear = (input: Parameters<typeof crearBorrador>[0]) => crearBorrador(input, db.prisma);
  const retomar = (id: string) => retomarBorrador(id, db.prisma);
  const expirar = (id: string) => expirarBorrador(id, db.prisma);
  const contabilizar = (input: Parameters<typeof contabilizarBorrador>[0]) =>
    contabilizarBorrador(input, db.prisma);

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
        codigo: "EMB-DP",
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
    const contenedor = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU0000001", estado: "DESCONSOLIDADO" },
    });
    // Lotes distintos: evita violar ItemContenedor_cp_null_idx (UNIQUE parcial
    // de prod sobre (contenedor, producto) WHERE loteFabricacion IS NULL).
    const icA = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: itemEmbarque.id,
        productoId: producto.id,
        loteFabricacion: "LOTE-A",
        cantidadDeclarada: 60,
        cantidadFisica: 60,
        cantidadDisponible: 60,
      },
    });
    const icB = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contenedor.id,
        itemEmbarqueId: itemEmbarque.id,
        productoId: producto.id,
        loteFabricacion: "LOTE-B",
        cantidadDeclarada: 40,
        cantidadFisica: 40,
        cantidadDisponible: 40,
      },
    });

    // Otro embarque/contenedor para probar ITEM_CONTENEDOR_AJENO.
    const embAjeno = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-AJ",
        proveedorId: proveedor.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
      },
    });
    const contAjeno = await db.prisma.contenedor.create({
      data: { embarqueId: embAjeno.id, numeroContenedor: "MSCU0000002", estado: "DESCONSOLIDADO" },
    });
    const icAjeno = await db.prisma.itemContenedor.create({
      data: {
        contenedorId: contAjeno.id,
        productoId: producto.id,
        cantidadDeclarada: 10,
        cantidadDisponible: 10,
      },
    });

    return {
      embarqueId: embarque.id,
      itemEmbarqueId: itemEmbarque.id,
      contenedorId: contenedor.id,
      itemContenedorA: icA.id,
      itemContenedorB: icB.id,
      itemContenedorAjeno: icAjeno.id,
      embarqueAjenoId: embAjeno.id,
    };
  }

  describe("crearBorrador (traba counters — A1)", () => {
    it("crea el borrador, traba counters y graba countsTrabados", async () => {
      const s = await seed();
      const borrador = await crear({
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 25 }],
      });

      expect(borrador.estadoActual).toBe("CONFIRMADO_TRABA_COUNTS");
      expect(borrador.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(borrador.countsTrabados).toEqual({ [s.itemContenedorA]: 25 });

      const icA = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.itemContenedorA },
      });
      expect(icA.cantidadDisponible).toBe(35); // 60 - 25
      expect(icA.cantidadEnDespacho).toBe(25);
      expect(icA.cantidadDespachada).toBe(0);
    });

    it("rechaza líneas vacías", async () => {
      const s = await seed();
      await expect(
        crear({ userId: "user-uuid", embarqueId: s.embarqueId, lineas: [] }),
      ).rejects.toMatchObject({ code: "LINEAS_VACIAS" });
    });

    it("rechaza cantidad no positiva", async () => {
      const s = await seed();
      await expect(
        crear({
          userId: "user-uuid",
          embarqueId: s.embarqueId,
          lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 0 }],
        }),
      ).rejects.toMatchObject({ code: "CANTIDAD_INVALIDA" });
    });

    it("rechaza itemContenedor inexistente", async () => {
      const s = await seed();
      await expect(
        crear({
          userId: "user-uuid",
          embarqueId: s.embarqueId,
          lineas: [{ itemContenedorId: 999999, cantidad: 1 }],
        }),
      ).rejects.toMatchObject({ code: "ITEM_CONTENEDOR_INEXISTENTE" });
    });

    it("rechaza itemContenedor de otro embarque (AJENO)", async () => {
      const s = await seed();
      await expect(
        crear({
          userId: "user-uuid",
          embarqueId: s.embarqueId,
          lineas: [{ itemContenedorId: s.itemContenedorAjeno, cantidad: 1 }],
        }),
      ).rejects.toMatchObject({ code: "ITEM_CONTENEDOR_AJENO" });
    });

    it("rechaza saldo insuficiente sin tocar counters (rollback)", async () => {
      const s = await seed();
      await expect(
        crear({
          userId: "user-uuid",
          embarqueId: s.embarqueId,
          lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 61 }],
        }),
      ).rejects.toMatchObject({ code: "SALDO_INSUFICIENTE" });

      const icA = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.itemContenedorA },
      });
      expect(icA.cantidadDisponible).toBe(60);
      expect(icA.cantidadEnDespacho).toBe(0);
    });
  });

  describe("retomarBorrador (P0-4)", () => {
    it("retoma un borrador vigente y devuelve el payloadDiff", async () => {
      const s = await seed();
      const creado = await crear({
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 10 }],
      });
      const retomado = await retomar(creado.id);
      expect(retomado.id).toBe(creado.id);
      expect(retomado.estadoActual).toBe("CONFIRMADO_TRABA_COUNTS");
      expect(retomado.payloadDiff).toEqual({
        lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 10 }],
      });
    });

    it("rechaza borrador inexistente", async () => {
      await expect(retomar("noexiste")).rejects.toMatchObject({ code: "BORRADOR_INEXISTENTE" });
    });

    it("rechaza retomar un borrador EXPIRADO (P0-4)", async () => {
      const s = await seed();
      const creado = await crear({
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 10 }],
      });
      await expirar(creado.id);
      await expect(retomar(creado.id)).rejects.toMatchObject({ code: "BORRADOR_EXPIRADO" });
    });
  });

  describe("expirarBorrador (EXPIRADO antes de liberar — P0-4)", () => {
    it("marca EXPIRADO y revierte los counters trabados", async () => {
      const s = await seed();
      const creado = await crear({
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 25 }],
      });
      const expirado = await expirar(creado.id);
      expect(expirado.estadoActual).toBe("EXPIRADO");

      const icA = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.itemContenedorA },
      });
      expect(icA.cantidadDisponible).toBe(60); // revertido
      expect(icA.cantidadEnDespacho).toBe(0);
    });

    it("es idempotente: expirar dos veces no infla los counters", async () => {
      const s = await seed();
      const creado = await crear({
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 25 }],
      });
      await expirar(creado.id);
      await expirar(creado.id);
      const icA = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.itemContenedorA },
      });
      expect(icA.cantidadDisponible).toBe(60);
      expect(icA.cantidadEnDespacho).toBe(0);
    });
  });

  describe("contabilizarBorrador (materializa Despacho cruzado — B)", () => {
    it("crea Despacho BORRADOR + ItemDespacho cruzado y mueve enDespacho→despachada, sin asiento", async () => {
      const s = await seed();
      const creado = await crear({
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 25 }],
      });
      const { despachoId } = await contabilizar({
        borradorId: creado.id,
        fecha: new Date("2025-06-15T12:00:00Z"),
      });

      const despacho = await db.prisma.despacho.findUniqueOrThrow({
        where: { id: despachoId },
        include: { items: true },
      });
      expect(despacho.estado).toBe("BORRADOR");
      expect(despacho.asientoId).toBeNull();
      expect(despacho.items).toHaveLength(1);
      expect(despacho.items[0]).toMatchObject({
        itemEmbarqueId: s.itemEmbarqueId,
        contenedorId: s.contenedorId,
        itemContenedorId: s.itemContenedorA,
        cantidad: 25,
      });

      const icA = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.itemContenedorA },
      });
      expect(icA.cantidadDisponible).toBe(35);
      expect(icA.cantidadEnDespacho).toBe(0); // movido
      expect(icA.cantidadDespachada).toBe(25);

      // El borrador se consume.
      expect(await db.prisma.despachoBorrador.findUnique({ where: { id: creado.id } })).toBeNull();
    });

    it("permite N líneas del mismo itemEmbarque desde itemContenedores distintos (índice cruzado #125)", async () => {
      const s = await seed();
      const creado = await crear({
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [
          { itemContenedorId: s.itemContenedorA, cantidad: 30 },
          { itemContenedorId: s.itemContenedorB, cantidad: 20 },
        ],
      });
      const { despachoId } = await contabilizar({
        borradorId: creado.id,
        fecha: new Date("2025-06-15T12:00:00Z"),
      });
      const items = await db.prisma.itemDespacho.findMany({ where: { despachoId } });
      expect(items).toHaveLength(2);
      expect(new Set(items.map((i) => i.itemContenedorId))).toEqual(
        new Set([s.itemContenedorA, s.itemContenedorB]),
      );
    });

    it("rechaza contabilizar un borrador EXPIRADO", async () => {
      const s = await seed();
      const creado = await crear({
        userId: "user-uuid",
        embarqueId: s.embarqueId,
        lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 10 }],
      });
      await expirar(creado.id);
      await expect(
        contabilizar({ borradorId: creado.id, fecha: new Date("2025-06-15T12:00:00Z") }),
      ).rejects.toMatchObject({ code: "BORRADOR_ESTADO_INVALIDO" });
    });
  });

  describe("materializarDespachoCruzado (camino directo — fuente DIRECTO)", () => {
    it("decrementa disponible→despachada en un solo paso (sin borrador)", async () => {
      const s = await seed();
      const { despachoId } = await db.prisma.$transaction((t) =>
        materializarDespachoCruzado(t, {
          embarqueId: s.embarqueId,
          fecha: new Date("2025-06-15T12:00:00Z"),
          fuente: "DIRECTO",
          lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 15 }],
        }),
      );
      const items = await db.prisma.itemDespacho.findMany({ where: { despachoId } });
      expect(items).toHaveLength(1);
      const icA = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.itemContenedorA },
      });
      expect(icA.cantidadDisponible).toBe(45); // 60 - 15
      expect(icA.cantidadEnDespacho).toBe(0);
      expect(icA.cantidadDespachada).toBe(15);
    });
  });

  describe("traba single-shot concurrente (PR 4.3)", () => {
    it("dos borradores concurrentes no sobrevenden cantidadDisponible", async () => {
      const s = await seed(); // itemContenedorA: disponible 60
      const intento = (cantidad: number) =>
        db.prisma.$transaction((t) =>
          crearBorrador(
            {
              userId: "user-uuid",
              embarqueId: s.embarqueId,
              lineas: [{ itemContenedorId: s.itemContenedorA, cantidad }],
            },
            t,
          ),
        );
      // 40 + 40 = 80 > 60: sólo uno puede ganar.
      const res = await Promise.allSettled([intento(40), intento(40)]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(res.filter((r) => r.status === "rejected")).toHaveLength(1);

      const icA = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.itemContenedorA },
      });
      expect(icA.cantidadDisponible).toBe(20); // 60 - 40 (un solo ganador)
      expect(icA.cantidadEnDespacho).toBe(40);
    });

    it("rechaza el sobregiro de saldo en una sola línea (0 filas afectadas)", async () => {
      const s = await seed();
      await expect(
        crear({
          userId: "user-uuid",
          embarqueId: s.embarqueId,
          lineas: [{ itemContenedorId: s.itemContenedorA, cantidad: 61 }],
        }),
      ).rejects.toMatchObject({ code: "SALDO_INSUFICIENTE" });
      const icA = await db.prisma.itemContenedor.findUniqueOrThrow({
        where: { id: s.itemContenedorA },
      });
      expect(icA.cantidadDisponible).toBe(60); // intacto
      expect(icA.cantidadEnDespacho).toBe(0);
    });
  });
});
