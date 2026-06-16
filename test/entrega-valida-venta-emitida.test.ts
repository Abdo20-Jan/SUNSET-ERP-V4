import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Onda B #11 — confirmar una entrega NO revalidaba que la venta siguiera
// EMITIDA. Si la venta fue CANCELADA después de crear la entrega BORRADOR,
// confirmar igual egresaba stock y DEBITABA 1.1.5.03 — cuyo crédito ya había
// sido revertido al anular la venta → débito huérfano. El guard exige
// venta.estado === EMITIDA en el confirm.

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

import { confirmarEntregaAction } from "@/lib/actions/entregas";

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("confirmar entrega — exige venta EMITIDA (Onda B #11)", () => {
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

  /** Venta + entrega BORRADOR con stock disponible; el estado de la venta lo fija el caller. */
  async function seed(ventaEstado: "EMITIDA" | "CANCELADA"): Promise<string> {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Prod", costoPromedio: "1000.00" },
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
        estado: ventaEstado,
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
    return entrega.id;
  }

  it("rechaza confirmar la entrega de una venta CANCELADA", async () => {
    const entregaId = await seed("CANCELADA");
    const res = await confirmarEntregaAction(entregaId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/EMITIDA|CANCELADA/i);

    // No egresó stock ni dejó asiento.
    const entrega = await db.prisma.entregaVenta.findUniqueOrThrow({ where: { id: entregaId } });
    expect(entrega.estado).toBe("BORRADOR");
    expect(entrega.asientoId).toBeNull();
    expect(await db.prisma.movimientoStock.count()).toBe(0);
  });

  it("confirma normal la entrega de una venta EMITIDA (control)", async () => {
    const entregaId = await seed("EMITIDA");
    const res = await confirmarEntregaAction(entregaId);
    expect(res.ok).toBe(true);
    const entrega = await db.prisma.entregaVenta.findUniqueOrThrow({ where: { id: entregaId } });
    expect(entrega.estado).toBe("CONFIRMADA");
    expect(entrega.asientoId).not.toBeNull();
  });
});
