import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recalcularSPDPorProducto } from "@/lib/services/stock";
import { createTestDb, type TestDb } from "./db";

// Onda B #8 — el replay de StockPorDeposito (recalcularSPDPorProducto) perdía el
// costo de las TRANSFERENCIAS: las trataba igual que un AJUSTE (`stock += cant`),
// SIN promediar el costo landed que trae el movimiento. Un depósito NACIONAL
// alimentado SÓLO por transferencias (caso Modelo Y: la nacionalización mueve
// stock DF→NACIONAL con un MovimientoStock TRANSFERENCIA) quedaba con
// costoPromedio = 0 → CMV calculado desde SPD daba 0 ("stock 0/0" del piloto).
//
// El agregado global (recalcularStockYCostoPromedio) ya promediaba bien la
// TRANSFERENCIA de entrada; este fix lo espeja en el replay por depósito.

const FECHA = (n: number) => new Date(`2026-05-${String(n).padStart(2, "0")}T12:00:00.000Z`);

describe("replay SPD — TRANSFERENCIA promedia el costo landed (Onda B #8)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset(["MovimientoStock", "StockPorDeposito", "Deposito", "Producto"]);
  });

  async function seed() {
    const prod = await db.prisma.producto.create({ data: { codigo: "P-1", nombre: "Prod" } });
    const dep = await db.prisma.deposito.create({
      data: { nombre: "Nacional", tipo: "NACIONAL" },
    });
    return { productoId: prod.id, depositoId: dep.id };
  }

  async function spd(productoId: string, depositoId: string) {
    return db.prisma.stockPorDeposito.findUniqueOrThrow({
      where: { productoId_depositoId: { productoId, depositoId } },
    });
  }

  it("depósito alimentado sólo por TRANSFERENCIA de entrada toma su costo landed", async () => {
    const s = await seed();
    // Nacionalización Modelo Y: ingresa 10 u al NACIONAL vía TRANSFERENCIA +10
    // con costo landed 1500/u. No hubo INGRESO previo en este depósito.
    await db.prisma.movimientoStock.create({
      data: {
        productoId: s.productoId,
        depositoId: s.depositoId,
        tipo: "TRANSFERENCIA",
        cantidad: 10,
        costoUnitario: "1500.00",
        fecha: FECHA(10),
      },
    });

    await recalcularSPDPorProducto(db.prisma, s.productoId);

    const row = await spd(s.productoId, s.depositoId);
    expect(row.cantidadFisica).toBe(10);
    // ANTES del fix: 0 (se sumaba la cantidad sin promediar el costo).
    expect(Number(row.costoPromedio)).toBeCloseTo(1500, 2);
  });

  it("promedia la TRANSFERENCIA de entrada contra el stock previo del depósito", async () => {
    const s = await seed();
    // INGRESO 10 @ 1000, luego TRANSFERENCIA +10 @ 2000 → promedio (10·1000 +
    // 10·2000)/20 = 1500; stock 20.
    await db.prisma.movimientoStock.createMany({
      data: [
        {
          productoId: s.productoId,
          depositoId: s.depositoId,
          tipo: "INGRESO",
          cantidad: 10,
          costoUnitario: "1000.00",
          fecha: FECHA(10),
        },
        {
          productoId: s.productoId,
          depositoId: s.depositoId,
          tipo: "TRANSFERENCIA",
          cantidad: 10,
          costoUnitario: "2000.00",
          fecha: FECHA(11),
        },
      ],
    });

    await recalcularSPDPorProducto(db.prisma, s.productoId);

    const row = await spd(s.productoId, s.depositoId);
    expect(row.cantidadFisica).toBe(20);
    expect(Number(row.costoPromedio)).toBeCloseTo(1500, 2);
  });

  it("la TRANSFERENCIA de salida (cantidad < 0) resta sin alterar el promedio", async () => {
    const s = await seed();
    await db.prisma.movimientoStock.createMany({
      data: [
        {
          productoId: s.productoId,
          depositoId: s.depositoId,
          tipo: "TRANSFERENCIA",
          cantidad: 10,
          costoUnitario: "1500.00",
          fecha: FECHA(10),
        },
        {
          productoId: s.productoId,
          depositoId: s.depositoId,
          tipo: "TRANSFERENCIA",
          cantidad: -4,
          costoUnitario: "0.00",
          fecha: FECHA(11),
        },
      ],
    });

    await recalcularSPDPorProducto(db.prisma, s.productoId);

    const row = await spd(s.productoId, s.depositoId);
    expect(row.cantidadFisica).toBe(6);
    // El promedio se mantiene en 1500 (la salida no lo diluye con costo 0).
    expect(Number(row.costoPromedio)).toBeCloseTo(1500, 2);
  });
});
