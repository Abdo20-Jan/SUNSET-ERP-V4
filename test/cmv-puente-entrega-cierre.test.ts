import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearAsientoEntrega, crearAsientoVenta } from "@/lib/services/asiento-automatico";
import { createTestDb, type TestDb } from "./db";

// Onda B #9 — cierre de la cuenta-puente 1.1.7.90 (MERCADERÍAS A ENTREGAR).
//
// Con stock dual, EMITIR la venta acredita 1.1.7.90 al costoPromedio GLOBAL del
// producto (CMV provisión). La ENTREGA cancelaba 1.1.7.90 al costoPromedio del
// SPD del depósito — otra base — así que 1.1.7.90 NO cerraba (residuo
// Σ(global − SPD)). Fix: la entrega DEBITA 1.1.7.90 por el snapshot que usó la
// venta (ItemVenta.costoUnitarioCmv), ACREDITA 1.1.7.01 por el costo físico real
// (SPD), y la diferencia va a una cuenta de variación de inventario
// (4.9.1.01 ingreso / 5.9.2.01 pérdida). Las ventas legacy (snapshot 0) caen al
// SPD como antes (sin variación).

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("ponte 1.1.7.90 — la entrega cierra contra el costo de la venta (Onda B #9)", () => {
  let db: TestDb;
  let seq = 0;

  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    seq += 1;
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

  /** Σ debe − Σ haber de una cuenta por código, sólo asientos vivos. */
  async function neto(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: { not: "ANULADO" } } },
      select: { debe: true, haber: true },
    });
    return lineas.reduce((a, l) => a + Number(l.debe) - Number(l.haber), 0);
  }
  async function debe(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: { not: "ANULADO" } } },
      select: { debe: true },
    });
    return lineas.reduce((a, l) => a + Number(l.debe), 0);
  }
  async function haber(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: { not: "ANULADO" } } },
      select: { haber: true },
    });
    return lineas.reduce((a, l) => a + Number(l.haber), 0);
  }

  /**
   * Crea una venta EMITIDA (1 ítem, cant 10) con producto a `costoGlobal` y SPD
   * en el depósito a `costoSpd`, contabiliza la venta, crea la entrega total con
   * costo SPD y la contabiliza. Devuelve ids útiles.
   */
  async function ventaYEntrega(costoGlobal: string, costoSpd: string) {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Prod", costoPromedio: costoGlobal },
    });
    const dep = await db.prisma.deposito.create({
      data: { nombre: `Dep ${seq}`, tipo: "NACIONAL" },
    });
    await db.prisma.stockPorDeposito.create({
      data: {
        productoId: prod.id,
        depositoId: dep.id,
        cantidadFisica: 50,
        costoPromedio: costoSpd,
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
        iva: "6300",
        total: "36300",
        estado: "EMITIDA",
        items: {
          create: [
            {
              productoId: prod.id,
              cantidad: 10,
              precioUnitario: "3000",
              subtotal: "30000",
              iva: "6300",
              total: "36300",
              depositoId: dep.id,
            },
          ],
        },
      },
      select: { id: true, items: { select: { id: true } } },
    });

    await crearAsientoVenta(venta.id, db.prisma);

    const entrega = await db.prisma.entregaVenta.create({
      data: {
        numero: `E-${seq}`,
        ventaId: venta.id,
        depositoId: dep.id,
        fecha: FECHA,
        estado: "BORRADOR",
        items: {
          create: [{ itemVentaId: venta.items[0]!.id, cantidad: 10, costoUnitario: costoSpd }],
        },
      },
      select: { id: true },
    });
    await crearAsientoEntrega(entrega.id, db.prisma);
    return { itemVentaId: venta.items[0]!.id };
  }

  it("costo SPD MAYOR que el de la venta: pérdida de inventario y 1.1.7.90 cierra", async () => {
    // venta a 1000 (CMV 10·1000 = 10.000); entrega física a 1200 (SPD).
    const r = await ventaYEntrega("1000.00", "1200.00");

    // El snapshot quedó persistido en la venta.
    const iv = await db.prisma.itemVenta.findUniqueOrThrow({ where: { id: r.itemVentaId } });
    expect(Number(iv.costoUnitarioCmv)).toBeCloseTo(1000, 2);

    // 1.1.7.90 cierra: HABER 10.000 (venta) − DEBE 10.000 (entrega) = 0.
    expect(await neto("1.1.7.90")).toBeCloseTo(0, 2);
    // 1.1.7.01 acreditada por el egreso físico real (SPD): 10·1200 = 12.000.
    expect(await haber("1.1.7.01")).toBeCloseTo(12_000, 2);
    // Diferencia (2.000) como PÉRDIDA de inventario (DEBE 5.9.2.01).
    expect(await debe("8.0.02")).toBeCloseTo(2_000, 2);
    expect(await haber("5.2.04")).toBeCloseTo(0, 2);
  });

  it("costo SPD MENOR que el de la venta: ingreso por diferencia y 1.1.7.90 cierra", async () => {
    // venta a 1200 (CMV 12.000); entrega física a 1000 (SPD).
    await ventaYEntrega("1200.00", "1000.00");

    expect(await neto("1.1.7.90")).toBeCloseTo(0, 2);
    // 1.1.7.01 por el egreso real: 10·1000 = 10.000.
    expect(await haber("1.1.7.01")).toBeCloseTo(10_000, 2);
    // Diferencia (2.000) como INGRESO por diferencia de inventario (HABER 4.9.1.01).
    expect(await haber("5.2.04")).toBeCloseTo(2_000, 2);
    expect(await debe("8.0.02")).toBeCloseTo(0, 2);
  });

  it("venta legacy (snapshot 0): la entrega cae al SPD, sin variación (control)", async () => {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Prod", costoPromedio: "1000.00" },
    });
    const dep = await db.prisma.deposito.create({
      data: { nombre: `Dep ${seq}`, tipo: "NACIONAL" },
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
          // Legacy: costoUnitarioCmv queda en el default 0 (pre-snapshot).
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
        items: {
          create: [{ itemVentaId: venta.items[0]!.id, cantidad: 10, costoUnitario: "1200.00" }],
        },
      },
      select: { id: true },
    });
    await crearAsientoEntrega(entrega.id, db.prisma);

    // Sin snapshot, la entrega cancela 1.1.7.90 al SPD (comportamiento previo):
    // DEBE 1.1.7.90 = 10·1200 = 12.000, HABER 1.1.7.01 = 12.000, sin variación.
    expect(await debe("1.1.7.90")).toBeCloseTo(12_000, 2);
    expect(await haber("1.1.7.01")).toBeCloseTo(12_000, 2);
    expect(await debe("8.0.02")).toBeCloseTo(0, 2);
    expect(await haber("5.2.04")).toBeCloseTo(0, 2);
  });
});
