import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// E8 — Las reversiones de transferencia deben recalcular el costo.
//
// Bug: al anular una transferencia (manual o de despacho) sólo se reponían
// cantidades, sin recalcular `costoPromedio` del SPD destino (quedaba
// contaminado por la mezcla) ni el agregado `Producto.stockActual`/
// `costoPromedio` (quedaba stale). Como el CMV de la próxima venta sale de
// esos campos, la anulación corrompía el costo. Fix: ambas reversiones
// delegan en `recalcularTrasReversionTransferencia` (borra movimientos →
// recalcula SPD + agregado + zera depósitos huérfanos).

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

import { anularTransferenciaAction, crearTransferenciaAction } from "@/lib/actions/transferencias";
import { recalcularTrasReversionTransferencia } from "@/lib/services/stock";

const FECHA_INGRESO = new Date("2026-05-10T12:00:00.000Z");
const FECHA_TRANSF = new Date("2026-05-15T12:00:00.000Z");

describe("E8 — anular transferencia recalcula costo (SPD + agregado)", () => {
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

  async function spd(productoId: string, depositoId: string) {
    return db.prisma.stockPorDeposito.findUnique({
      where: { productoId_depositoId: { productoId, depositoId } },
    });
  }

  it("anular transferencia manual NACIONAL→NACIONAL restaura el costo del destino y el agregado", async () => {
    // Origen 50@1000 y destino 10@2000 (costos distintos: si la reversión no
    // recalcula, el promedio del destino queda contaminado en 1500).
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Prod", stockActual: 60, costoPromedio: "1166.67" },
    });
    const origen = await db.prisma.deposito.create({
      data: { nombre: `Origen ${seq}`, tipo: "NACIONAL" },
    });
    const destino = await db.prisma.deposito.create({
      data: { nombre: `Destino ${seq}`, tipo: "NACIONAL" },
    });
    await db.prisma.stockPorDeposito.createMany({
      data: [
        {
          productoId: prod.id,
          depositoId: origen.id,
          cantidadFisica: 50,
          costoPromedio: "1000.00",
        },
        {
          productoId: prod.id,
          depositoId: destino.id,
          cantidadFisica: 10,
          costoPromedio: "2000.00",
        },
      ],
    });
    await db.prisma.movimientoStock.createMany({
      data: [
        {
          productoId: prod.id,
          depositoId: origen.id,
          tipo: "INGRESO",
          cantidad: 50,
          costoUnitario: "1000.00",
          fecha: FECHA_INGRESO,
        },
        {
          productoId: prod.id,
          depositoId: destino.id,
          tipo: "INGRESO",
          cantidad: 10,
          costoUnitario: "2000.00",
          fecha: FECHA_INGRESO,
        },
      ],
    });

    // Transferir 10 del origen al destino: el destino promedia a 1500.
    const creada = await crearTransferenciaAction({
      productoId: prod.id,
      depositoOrigenId: origen.id,
      depositoDestinoId: destino.id,
      cantidad: 10,
      fecha: FECHA_TRANSF,
    });
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;
    const destinoMezclado = await spd(prod.id, destino.id);
    expect(destinoMezclado?.cantidadFisica).toBe(20);
    expect(Number(destinoMezclado?.costoPromedio)).toBeCloseTo(1500, 2);

    // Anular: debe deshacer la mezcla y recalcular SPD + agregado.
    const anulada = await anularTransferenciaAction(creada.data.transferenciaId);
    expect(anulada.ok).toBe(true);

    const origenFinal = await spd(prod.id, origen.id);
    const destinoFinal = await spd(prod.id, destino.id);
    expect(origenFinal?.cantidadFisica).toBe(50);
    expect(Number(origenFinal?.costoPromedio)).toBeCloseTo(1000, 2);
    // El destino vuelve a 10@2000 — NO 20@1500 ni 10@1500.
    expect(destinoFinal?.cantidadFisica).toBe(10);
    expect(Number(destinoFinal?.costoPromedio)).toBeCloseTo(2000, 2);

    // Agregado recalculado desde los INGRESO restantes (50@1000 + 10@2000).
    const prodFinal = await db.prisma.producto.findUniqueOrThrow({ where: { id: prod.id } });
    expect(prodFinal.stockActual).toBe(60);
    expect(Number(prodFinal.costoPromedio)).toBeCloseTo(1166.67, 2);
  });

  it("recalcularTrasReversionTransferencia recompone el agregado tras revertir una transferencia de despacho (ZPA→NACIONAL)", async () => {
    // Simula el estado POST-borrado de movimientos de una reversión de
    // despacho: queda sólo el INGRESO nacional previo (5@1000); el agregado y
    // el SPD destino están stale como si la transferencia nacionalizada (que
    // ya fue borrada) siguiera contando.
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Prod", stockActual: 15, costoPromedio: "3666.67" },
    });
    const zpa = await db.prisma.deposito.create({
      data: { nombre: `ZPA ${seq}`, tipo: "ZONA_PRIMARIA" },
    });
    const nacional = await db.prisma.deposito.create({
      data: { nombre: `Nacional ${seq}`, tipo: "NACIONAL" },
    });
    await db.prisma.stockPorDeposito.create({
      data: {
        productoId: prod.id,
        depositoId: nacional.id,
        cantidadFisica: 15,
        costoPromedio: "3666.67",
      },
    });
    await db.prisma.movimientoStock.create({
      data: {
        productoId: prod.id,
        depositoId: nacional.id,
        tipo: "INGRESO",
        cantidad: 5,
        costoUnitario: "1000.00",
        fecha: FECHA_INGRESO,
      },
    });

    await recalcularTrasReversionTransferencia(
      db.prisma,
      new Map([[prod.id, new Set([zpa.id, nacional.id])]]),
    );

    // Agregado vuelve a 5@1000 (sólo el INGRESO nacional restante), no stale.
    const prodFinal = await db.prisma.producto.findUniqueOrThrow({ where: { id: prod.id } });
    expect(prodFinal.stockActual).toBe(5);
    expect(Number(prodFinal.costoPromedio)).toBeCloseTo(1000, 2);
    const nacFinal = await spd(prod.id, nacional.id);
    expect(nacFinal?.cantidadFisica).toBe(5);
    expect(Number(nacFinal?.costoPromedio)).toBeCloseTo(1000, 2);
  });
});
