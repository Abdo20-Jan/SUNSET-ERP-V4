import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Onda C #12 — la transferencia manual (crearTransferenciaAction) NO debe poder
// mover stock que entra o sale de un depósito ZONA_PRIMARIA (bonded). Nacionalizar
// mercadería (ZPA/DF → NACIONAL) mueve stock físico a vendible SIN generar el
// asiento del despacho (DEBE 1.1.5.01 / HABER 1.1.5.04/05) ni los tributos →
// el físico queda nacionalizado pero las cuentas COMEX 1.1.5.04/05 siguen
// cargadas → físico ≠ saldo. El movimiento de mercadería bonded SÓLO puede ir
// por el flujo COMEX (desconsolidación / despacho), que sí contabiliza.

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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { crearTransferenciaAction } from "@/lib/actions/transferencias";

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("transferencia manual — bloquea depósitos ZONA_PRIMARIA (Onda C #12)", () => {
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
      "MovimientoStock",
      "Transferencia",
      "StockPorDeposito",
      "Deposito",
      "Producto",
    ]);
  });

  /** Crea producto + 2 depósitos con los tipos pedidos y stock en el origen. */
  async function seed(
    tipoOrigen: "NACIONAL" | "ZONA_PRIMARIA",
    tipoDestino: "NACIONAL" | "ZONA_PRIMARIA",
  ): Promise<{ productoId: string; origenId: string; destinoId: string }> {
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Prod", costoPromedio: "1000.00" },
    });
    const origen = await db.prisma.deposito.create({
      data: { nombre: `Origen ${seq}`, tipo: tipoOrigen },
    });
    const destino = await db.prisma.deposito.create({
      data: { nombre: `Destino ${seq}`, tipo: tipoDestino },
    });
    await db.prisma.stockPorDeposito.create({
      data: {
        productoId: prod.id,
        depositoId: origen.id,
        cantidadFisica: 50,
        costoPromedio: "1000.00",
      },
    });
    return { productoId: prod.id, origenId: origen.id, destinoId: destino.id };
  }

  async function spd(productoId: string, depositoId: string) {
    return db.prisma.stockPorDeposito.findUnique({
      where: { productoId_depositoId: { productoId, depositoId } },
    });
  }

  it("rechaza nacionalizar manualmente: ZONA_PRIMARIA → NACIONAL", async () => {
    const { productoId, origenId, destinoId } = await seed("ZONA_PRIMARIA", "NACIONAL");
    const res = await crearTransferenciaAction({
      productoId,
      depositoOrigenId: origenId,
      depositoDestinoId: destinoId,
      cantidad: 10,
      fecha: FECHA,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/zona primaria|despacho|desconsolidac/i);

    // No movió stock ni dejó Transferencia / MovimientoStock.
    const origen = await spd(productoId, origenId);
    expect(origen?.cantidadFisica).toBe(50);
    expect(await spd(productoId, destinoId)).toBeNull();
    expect(await db.prisma.transferencia.count()).toBe(0);
    expect(await db.prisma.movimientoStock.count()).toBe(0);
  });

  it("rechaza meter stock vendible en bonded: NACIONAL → ZONA_PRIMARIA", async () => {
    const { productoId, origenId, destinoId } = await seed("NACIONAL", "ZONA_PRIMARIA");
    const res = await crearTransferenciaAction({
      productoId,
      depositoOrigenId: origenId,
      depositoDestinoId: destinoId,
      cantidad: 10,
      fecha: FECHA,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/zona primaria|despacho|desconsolidac/i);

    const origen = await spd(productoId, origenId);
    expect(origen?.cantidadFisica).toBe(50);
    expect(await db.prisma.transferencia.count()).toBe(0);
    expect(await db.prisma.movimientoStock.count()).toBe(0);
  });

  it("permite la transferencia normal entre depósitos NACIONAL (control)", async () => {
    const { productoId, origenId, destinoId } = await seed("NACIONAL", "NACIONAL");
    const res = await crearTransferenciaAction({
      productoId,
      depositoOrigenId: origenId,
      depositoDestinoId: destinoId,
      cantidad: 10,
      fecha: FECHA,
    });
    expect(res.ok).toBe(true);

    const origen = await spd(productoId, origenId);
    expect(origen?.cantidadFisica).toBe(40);
    const destino = await spd(productoId, destinoId);
    expect(destino?.cantidadFisica).toBe(10);
    expect(await db.prisma.transferencia.count()).toBe(1);
    // 2 MovimientoStock TRANSFERENCIA (salida origen + entrada destino).
    expect(await db.prisma.movimientoStock.count()).toBe(2);
  });
});
