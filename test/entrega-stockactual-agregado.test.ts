import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// E16 (resíduo) — confirmar/anular una entrega movía el SPD del depósito pero
// NO recalculaba el agregado `Producto.stockActual`/`costoPromedio`. Como
// `crearAsientoVenta` toma el CMV de `Producto.costoPromedio` y maestros/reportes
// leen `stockActual`, el agregado quedaba sobrestimado tras cada egreso (y
// dessincronizado tras la anulación). El fix espeja el patrón forward
// (`recalcularStockYCostoPromedio`) en ambos lados.

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

import { anularEntregaAction, confirmarEntregaAction } from "@/lib/actions/entregas";

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("entrega recalcula el agregado Producto.stockActual (E16 resíduo)", () => {
  let db: TestDb;
  let seq = 0;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    seq += 1;
    vi.clearAllMocks();
    process.env.STOCK_DUAL_ENABLED = "true";
    await db.reset([
      "ItemEntrega",
      "EntregaVenta",
      "ItemVenta",
      "Venta",
      "MovimientoStock",
      "StockPorDeposito",
      "LineaAsiento",
      "Asiento",
      "Producto",
      "Cliente",
      "Deposito",
      "PeriodoContable",
      "CuentaContable",
    ]);
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2026-05",
        nombre: "Mayo 2026",
        fechaInicio: new Date("2026-05-01T00:00:00.000Z"),
        fechaFin: new Date("2026-05-31T23:59:59.999Z"),
        estado: "ABIERTO",
      },
    });
  });

  interface Seed {
    entregaId: string;
    productoId: string;
  }

  // Producto NACIONAL con 50 de stock: agregado (stockActual/costoPromedio) +
  // SPD + un INGRESO real que respalda el replay del recalc (sin él, el replay
  // daría negativo). Venta EMITIDA por 10, entrega BORRADOR por 10.
  async function seed(): Promise<Seed> {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Prod", stockActual: 50, costoPromedio: "1000.00" },
    });
    const dep = await db.prisma.deposito.create({
      data: { nombre: `Dep ${seq}`, tipo: "NACIONAL" },
    });
    await db.prisma.stockPorDeposito.create({
      data: {
        productoId: prod.id,
        depositoId: dep.id,
        cantidadFisica: 50,
        costoPromedio: "1000.00",
      },
    });
    await db.prisma.movimientoStock.create({
      data: {
        productoId: prod.id,
        depositoId: dep.id,
        tipo: "INGRESO",
        cantidad: 50,
        costoUnitario: "1000.00",
        fecha: new Date("2026-05-10T12:00:00.000Z"),
      },
    });
    const venta = await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId: cli.id,
        fecha: FECHA,
        moneda: "ARS",
        tipoCambio: "1",
        subtotal: "30000",
        iva: "0",
        total: "30000",
        estado: "EMITIDA",
        items: {
          create: [
            {
              productoId: prod.id,
              cantidad: 10,
              precioUnitario: "3000",
              subtotal: "30000",
              iva: "0",
              total: "30000",
              depositoId: dep.id,
            },
          ],
        },
      },
      select: { id: true, items: { select: { id: true } } },
    });
    const entrega = await db.prisma.entregaVenta.create({
      data: {
        numero: `E-${seq}`,
        ventaId: venta.id,
        depositoId: dep.id,
        fecha: FECHA,
        estado: "BORRADOR",
        items: { create: [{ itemVentaId: venta.items[0]!.id, cantidad: 10, costoUnitario: "0" }] },
      },
      select: { id: true },
    });
    return { entregaId: entrega.id, productoId: prod.id };
  }

  it("confirmar entrega decrementa el agregado Producto.stockActual (50 → 40)", async () => {
    const s = await seed();
    const res = await confirmarEntregaAction(s.entregaId);
    expect(res.ok).toBe(true);

    // SPD del depósito ya bajaba antes del fix.
    const spd = await db.prisma.stockPorDeposito.findFirstOrThrow({
      where: { productoId: s.productoId },
    });
    expect(spd.cantidadFisica).toBe(40);

    // Agregado: antes del fix quedaba en 50 (stale).
    const prod = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoId } });
    expect(prod.stockActual).toBe(40);
    expect(Number(prod.costoPromedio)).toBe(1000); // egreso al promedio no cambia el costo
  });

  it("anular entrega confirmada restaura el agregado Producto.stockActual (40 → 50)", async () => {
    const s = await seed();
    await confirmarEntregaAction(s.entregaId);
    const prodPost = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoId } });
    expect(prodPost.stockActual).toBe(40); // precondición: el confirm ya corrige el agregado

    const res = await anularEntregaAction(s.entregaId);
    expect(res.ok).toBe(true);

    const spd = await db.prisma.stockPorDeposito.findFirstOrThrow({
      where: { productoId: s.productoId },
    });
    expect(spd.cantidadFisica).toBe(50);

    // Agregado restaurado: antes del fix de la reversión quedaba en 40 (stale).
    const prod = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoId } });
    expect(prod.stockActual).toBe(50);
    expect(Number(prod.costoPromedio)).toBe(1000);
  });
});
