import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Onda B #13 — anularAsientoAction (anulación genérica vía /contabilidad/asientos)
// bloqueaba sólo asientos de Zona Primaria y Despacho. Anular el asiento de una
// VENTA, ENTREGA o GASTO por esa vía dejaba datos operacionales huérfanos
// (venta EMITIDA con reservas, entrega CONFIRMADA con asiento ANULADO). El guard
// bloquea esos asientos y deriva al flujo dedicado (Anular venta/entrega/gasto).

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

import { anularAsientoAction } from "@/lib/actions/asientos";

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("anularAsientoAction — guard venta/entrega/gasto (Onda B #13)", () => {
  let db: TestDb;
  let seq = 0;
  let periodoId: number;

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
    await db.reset([
      "ItemEntrega",
      "EntregaVenta",
      "ItemVenta",
      "Venta",
      "Gasto",
      "LineaAsiento",
      "Asiento",
      "Producto",
      "Cliente",
      "Proveedor",
      "Deposito",
      "PeriodoContable",
    ]);
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2026-05",
        nombre: "Mayo 2026",
        fechaInicio: new Date("2026-05-01T00:00:00.000Z"),
        fechaFin: new Date("2026-05-31T23:59:59.999Z"),
        estado: "ABIERTO",
      },
    });
    periodoId = periodo.id;
  });

  async function crearAsiento(): Promise<string> {
    const a = await db.prisma.asiento.create({
      data: {
        numero: seq * 100 + 1,
        fecha: FECHA,
        descripcion: `Asiento ${seq}`,
        estado: "CONTABILIZADO",
        origen: "MANUAL",
        moneda: "ARS",
        tipoCambio: "1",
        totalDebe: "0",
        totalHaber: "0",
        periodoId,
      },
    });
    return a.id;
  }

  it("anula normal un asiento manual sin vínculo operacional (control)", async () => {
    const asientoId = await crearAsiento();
    const res = await anularAsientoAction(asientoId);
    expect(res.ok).toBe(true);
    const a = await db.prisma.asiento.findUniqueOrThrow({ where: { id: asientoId } });
    expect(a.estado).toBe("ANULADO");
  });

  it("rechaza anular el asiento de una VENTA", async () => {
    const asientoId = await crearAsiento();
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId: cli.id,
        fecha: FECHA,
        moneda: "ARS",
        subtotal: "0",
        iva: "0",
        total: "0",
        estado: "EMITIDA",
        asientoId,
      },
    });
    const res = await anularAsientoAction(asientoId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/venta/i);
    const a = await db.prisma.asiento.findUniqueOrThrow({ where: { id: asientoId } });
    expect(a.estado).toBe("CONTABILIZADO");
  });

  it("rechaza anular el asiento de una ENTREGA", async () => {
    const asientoId = await crearAsiento();
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const dep = await db.prisma.deposito.create({
      data: { nombre: `Dep ${seq}`, tipo: "NACIONAL" },
    });
    const venta = await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId: cli.id,
        fecha: FECHA,
        moneda: "ARS",
        subtotal: "0",
        iva: "0",
        total: "0",
        estado: "EMITIDA",
      },
      select: { id: true },
    });
    await db.prisma.entregaVenta.create({
      data: {
        numero: `E-${seq}`,
        ventaId: venta.id,
        depositoId: dep.id,
        fecha: FECHA,
        estado: "CONFIRMADA",
        asientoId,
      },
    });
    const res = await anularAsientoAction(asientoId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/entrega/i);
  });

  it("rechaza anular el asiento de un GASTO", async () => {
    const asientoId = await crearAsiento();
    const prov = await db.prisma.proveedor.create({ data: { nombre: `Prov ${seq}` } });
    await db.prisma.gasto.create({
      data: {
        numero: `G-${seq}`,
        proveedorId: prov.id,
        fecha: FECHA,
        moneda: "ARS",
        subtotal: "100",
        total: "100",
        estado: "CONTABILIZADO",
        asientoId,
      },
    });
    const res = await anularAsientoAction(asientoId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/gasto/i);
  });
});
