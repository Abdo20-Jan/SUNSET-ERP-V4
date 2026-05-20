import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 2.2 — server actions del packing list. Integración con BD real
// (testcontainers), enrutando el singleton `db` al client del contenedor y
// mockeando auth / next/cache (que requieren runtime de Next).

const h = vi.hoisted(() => {
  let client: PrismaClient | undefined;
  let session: unknown = { user: { id: "tester" } };
  return {
    setClient: (c: PrismaClient) => {
      client = c;
    },
    setSession: (s: unknown) => {
      session = s;
    },
    // Proxy que reenvía al client del contenedor (late-bound).
    dbProxy: new Proxy(
      {},
      {
        get(_t, prop) {
          // biome-ignore lint/suspicious/noExplicitAny: forwarding genérico al client
          const value = (client as any)?.[prop];
          return typeof value === "function" ? value.bind(client) : value;
        },
      },
    ),
    auth: vi.fn(async () => session),
  };
});

vi.mock("@/lib/db", () => ({ db: h.dbProxy }));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Imports DESPUÉS de los mocks (vi.mock está hoisteado igual).
import { revalidatePath } from "next/cache";
import {
  actualizarPackingListAction,
  crearContenedorAction,
  eliminarContenedorAction,
} from "@/lib/actions/contenedores";

describe("server actions contenedores (PR 2.2)", () => {
  let db: TestDb;
  let embarqueId: string;
  let productoA: string;

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
    h.setSession({ user: { id: "tester" } });

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
    productoA = pa.id;
    const emb = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-001",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        items: { create: [{ productoId: pa.id, cantidad: 100, precioUnitarioFob: "10.00" }] },
      },
    });
    embarqueId = emb.id;
  });

  describe("gate (flag + auth)", () => {
    it("flag apagada → no habilitado, sin tocar la BD", async () => {
      process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "false";
      const res = await crearContenedorAction({ embarqueId, numeroContenedor: "C1" });
      expect(res).toEqual({ ok: false, error: "El módulo de contenedores no está habilitado." });
      expect(await db.prisma.contenedor.count()).toBe(0);
    });

    it("sin sesión → No autorizado", async () => {
      h.setSession(null);
      const res = await crearContenedorAction({ embarqueId, numeroContenedor: "C1" });
      expect(res).toEqual({ ok: false, error: "No autorizado." });
    });
  });

  describe("crearContenedorAction", () => {
    it("happy path: persiste y revalida", async () => {
      const res = await crearContenedorAction({
        embarqueId,
        numeroContenedor: "MSCU1234567",
        items: [{ productoId: productoA, cantidadDeclarada: 50 }],
      });
      expect(res.ok).toBe(true);
      expect(await db.prisma.contenedor.count()).toBe(1);
      expect(revalidatePath).toHaveBeenCalledWith(`/comex/embarques/${embarqueId}`);
    });

    it("input inválido (numeroContenedor vacío) → Datos inválidos", async () => {
      const res = await crearContenedorAction({ embarqueId, numeroContenedor: "" });
      expect(res).toEqual({ ok: false, error: "Datos inválidos." });
    });

    it("producto ajeno → error de dominio mapeado", async () => {
      const otro = await db.prisma.producto.create({ data: { codigo: "P-X", nombre: "Ajeno" } });
      const res = await crearContenedorAction({
        embarqueId,
        numeroContenedor: "C1",
        items: [{ productoId: otro.id, cantidadDeclarada: 5 }],
      });
      expect(res).toEqual({ ok: false, error: "Hay un producto que no pertenece al embarque." });
    });
  });

  describe("actualizarPackingListAction", () => {
    it("happy path", async () => {
      const cont = await db.prisma.contenedor.create({
        data: { embarqueId, numeroContenedor: "C1" },
      });
      const res = await actualizarPackingListAction({
        contenedorId: cont.id,
        expectedUpdatedAt: cont.updatedAt,
        items: [{ productoId: productoA, cantidadDeclarada: 30 }],
      });
      expect(res).toEqual({ ok: true, contenedorId: cont.id });
      expect(await db.prisma.itemContenedor.count()).toBe(1);
    });

    it("token viejo → mensaje de concurrencia", async () => {
      const cont = await db.prisma.contenedor.create({
        data: { embarqueId, numeroContenedor: "C1" },
      });
      const res = await actualizarPackingListAction({
        contenedorId: cont.id,
        expectedUpdatedAt: new Date(cont.updatedAt.getTime() - 1000),
        items: [{ productoId: productoA, cantidadDeclarada: 30 }],
      });
      expect(res).toEqual({
        ok: false,
        error: "El contenedor fue modificado por otro usuario. Recargá y reintentá.",
      });
    });
  });

  describe("eliminarContenedorAction", () => {
    it("happy path", async () => {
      const cont = await db.prisma.contenedor.create({
        data: { embarqueId, numeroContenedor: "C1" },
      });
      const res = await eliminarContenedorAction(cont.id);
      expect(res).toEqual({ ok: true, contenedorId: cont.id });
      expect(await db.prisma.contenedor.count()).toBe(0);
    });

    it("id vacío → Datos inválidos", async () => {
      const res = await eliminarContenedorAction("");
      expect(res).toEqual({ ok: false, error: "Datos inválidos." });
    });
  });
});
