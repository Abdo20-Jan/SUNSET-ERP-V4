import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// PR 5.3 — BI bonded. `getAnalisisBonded` resume el stock en depósito fiscal:
// valor USD (Σ disponible × costoFCUnitario), aging p50/p90 de los contenedores
// en DF y despachos abiertos por SKU (cantidadEnDespacho). Gated por la flag.

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

import { getAnalisisBonded } from "@/lib/services/bi";

const DAY = 86_400_000;
const diasAtras = (n: number) => new Date(Date.now() - (n * DAY + DAY / 2));

describe("getAnalisisBonded — BI del depósito fiscal (PR 5.3)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    await db.reset(["ItemContenedor", "Contenedor", "Embarque", "Producto", "Proveedor"]);
  });

  async function seed() {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const p1 = await db.prisma.producto.create({ data: { codigo: "SKU-1", nombre: "Neumático" } });
    const p2 = await db.prisma.producto.create({ data: { codigo: "SKU-2", nombre: "Llanta" } });
    const embarque = await db.prisma.embarque.create({
      data: { codigo: "EMB-1", proveedorId: prov.id, moneda: "USD", tipoCambio: "1000.000000" },
    });

    async function cont(
      numero: string,
      estado: "DESCONSOLIDADO" | "PARCIALMENTE_DESPACHADO" | "EN_DEPOSITO_FISCAL" | "EN_TRANSITO",
      fechaDesconsolidacion: Date | null,
      ic: {
        productoId: string;
        declarada: number;
        disponible?: number;
        enDespacho?: number;
        costoFC?: string;
      },
    ) {
      const c = await db.prisma.contenedor.create({
        data: { embarqueId: embarque.id, numeroContenedor: numero, estado, fechaDesconsolidacion },
      });
      await db.prisma.itemContenedor.create({
        data: {
          contenedorId: c.id,
          productoId: ic.productoId,
          cantidadDeclarada: ic.declarada,
          cantidadDisponible: ic.disponible ?? 0,
          cantidadEnDespacho: ic.enDespacho ?? 0,
          costoFCUnitario: ic.costoFC ?? null,
        },
      });
    }

    await cont("CONT-A", "DESCONSOLIDADO", diasAtras(10), {
      productoId: p1.id,
      declarada: 100,
      disponible: 100,
      costoFC: "10.0000",
    });
    await cont("CONT-B", "PARCIALMENTE_DESPACHADO", diasAtras(30), {
      productoId: p1.id,
      declarada: 70,
      disponible: 50,
      enDespacho: 20,
      costoFC: "10.0000",
    });
    await cont("CONT-C", "EN_DEPOSITO_FISCAL", diasAtras(90), {
      productoId: p2.id,
      declarada: 10,
      disponible: 10,
      costoFC: "5.0000",
    });
    // Fuera del DF (en tránsito): no entra al BI bonded.
    await cont("CONT-D", "EN_TRANSITO", null, { productoId: p1.id, declarada: 100 });
  }

  it("con la flag OFF devuelve null", async () => {
    await seed();
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "false";
    expect(await getAnalisisBonded()).toBeNull();
  });

  it("KPIs: valor USD, unidades disponibles, SKUs y contenedores en DF", async () => {
    await seed();
    const r = await getAnalisisBonded();
    if (!r) throw new Error("flag off?");
    expect(r.kpis.valorUsd).toBe(1550); // 100×10 + 50×10 + 10×5
    expect(r.kpis.unidadesDisponibles).toBe(160); // 100 + 50 + 10
    expect(r.kpis.skus).toBe(2);
    expect(r.kpis.contenedores).toBe(3); // A, B, C (D está en tránsito)
  });

  it("aging p50/p90 de los contenedores en DF", async () => {
    await seed();
    const r = await getAnalisisBonded();
    if (!r) throw new Error("flag off?");
    // edades [10, 30, 90] → p50 = 30, p90 = 90
    expect(r.aging.p50).toBe(30);
    expect(r.aging.p90).toBe(90);
  });

  it("porSku ordenado por valor + despachos abiertos por SKU", async () => {
    await seed();
    const r = await getAnalisisBonded();
    if (!r) throw new Error("flag off?");
    expect(r.porSku[0]).toMatchObject({ codigo: "SKU-1", disponible: 150, valorUsd: 1500 });
    expect(r.porSku[1]).toMatchObject({ codigo: "SKU-2", disponible: 10, valorUsd: 50 });
    // Sólo SKU-1 tiene cantidadEnDespacho.
    expect(r.despachosAbiertos).toHaveLength(1);
    expect(r.despachosAbiertos[0]).toMatchObject({ codigo: "SKU-1", unidades: 20, valorUsd: 200 });
  });
});
