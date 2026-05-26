import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 5.2 — vista comex/aduanero segmentada por fase. `listarStockAduanero`
// pasa a cubrir TODO el pipeline (no sólo el bonded) y reparte la cantidad
// viva de cada ItemContenedor en cuatro columnas derivadas de Contenedor.estado
// + cantidadEnDespacho: EN_TRANSITO / EN_ZPA / EN_DF / EN_DESPACHO.

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

import { listarStockAduanero } from "@/lib/actions/inventario";

describe("listarStockAduanero — segmentación por fase aduanera (PR 5.2)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
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
      "Deposito",
      "Producto",
      "Proveedor",
    ]);
  });

  async function seed() {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "SKU-1", nombre: "Neumático" },
    });
    const df = await db.prisma.deposito.create({ data: { nombre: "DF Buenos Aires" } });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: "EMB-1", proveedorId: prov.id, moneda: "USD", tipoCambio: "1000.000000" },
    });

    // Helper: crea un contenedor en `estado` con un ItemContenedor del producto.
    async function cont(
      numero: string,
      estado:
        | "EN_TRANSITO"
        | "EN_ZONA_PRIMARIA"
        | "DESCONSOLIDADO"
        | "PARCIALMENTE_DESPACHADO"
        | "TOTALMENTE_DESPACHADO"
        | "CANCELADO",
      counters: {
        declarada: number;
        disponible?: number;
        enDespacho?: number;
        despachada?: number;
      },
    ) {
      const c = await db.prisma.contenedor.create({
        data: {
          embarqueId: embarque.id,
          numeroContenedor: numero,
          estado,
          depositoFiscalId: df.id,
        },
      });
      await db.prisma.itemContenedor.create({
        data: {
          contenedorId: c.id,
          productoId: prod.id,
          cantidadDeclarada: counters.declarada,
          cantidadDisponible: counters.disponible ?? 0,
          cantidadEnDespacho: counters.enDespacho ?? 0,
          cantidadDespachada: counters.despachada ?? 0,
        },
      });
      return c.id;
    }

    await cont("MSCU-TRANSITO", "EN_TRANSITO", { declarada: 100 });
    await cont("MSCU-ZPA", "EN_ZONA_PRIMARIA", { declarada: 50 });
    await cont("MSCU-DF", "DESCONSOLIDADO", { declarada: 80, disponible: 80 });
    await cont("MSCU-PARCIAL", "PARCIALMENTE_DESPACHADO", {
      declarada: 60,
      disponible: 20,
      enDespacho: 10,
      despachada: 30,
    });
    // Excluidos del pipeline vivo: totalmente despachado y cancelado.
    await cont("MSCU-TOTAL", "TOTALMENTE_DESPACHADO", { declarada: 40, despachada: 40 });
    await cont("MSCU-CANCEL", "CANCELADO", { declarada: 40 });

    return { productoId: prod.id };
  }

  it("reparte la cantidad viva en EN_TRANSITO / EN_ZPA / EN_DF / EN_DESPACHO", async () => {
    const s = await seed();
    const { filas } = await listarStockAduanero();

    expect(filas).toHaveLength(1);
    const fila = filas[0]!;
    expect(fila.productoId).toBe(s.productoId);
    expect(fila.enTransito).toBe(100); // contenedor EN_TRANSITO (declarada)
    expect(fila.enZpa).toBe(50); // contenedor EN_ZONA_PRIMARIA (declarada)
    expect(fila.enDf).toBe(100); // 80 (desconsolidado) + 20 (parcial disponible)
    expect(fila.enDespacho).toBe(10); // parcial en despacho
  });

  it("excluye contenedores TOTALMENTE_DESPACHADO y CANCELADO del drill-down", async () => {
    await seed();
    const { filas } = await listarStockAduanero();
    const numeros = filas[0]!.contenedores.map((c) => c.numeroContenedor).sort();
    expect(numeros).toEqual(["MSCU-DF", "MSCU-PARCIAL", "MSCU-TRANSITO", "MSCU-ZPA"]);
  });

  it("cada contenedor del drill-down lleva su fase y counters segmentados", async () => {
    await seed();
    const { filas } = await listarStockAduanero();
    const porNumero = new Map(filas[0]!.contenedores.map((c) => [c.numeroContenedor, c]));

    expect(porNumero.get("MSCU-TRANSITO")).toMatchObject({
      estado: "EN_TRANSITO",
      enTransito: 100,
      enZpa: 0,
      enDf: 0,
      enDespacho: 0,
    });
    expect(porNumero.get("MSCU-PARCIAL")).toMatchObject({
      estado: "PARCIALMENTE_DESPACHADO",
      enDf: 20,
      enDespacho: 10,
      cantidadDespachada: 30,
    });
  });

  it("filtra por código/nombre de producto", async () => {
    await seed();
    const vacio = await listarStockAduanero({ search: "no-existe" });
    expect(vacio.filas).toHaveLength(0);
    const hit = await listarStockAduanero({ search: "neum" });
    expect(hit.filas).toHaveLength(1);
  });
});
