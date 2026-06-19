import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearAsientoVenta } from "@/lib/services/asiento-automatico";
import { createTestDb, type TestDb } from "./db";

// Onda B #10 — emitir una venta cuyo producto tiene costoPromedio = 0 omitía el
// CMV silenciosamente: el bloque `if (totalCosto.gt(0))` no corría, así que no
// se acreditaba 1.1.7.90 MERCADERÍAS A ENTREGAR. Con stock dual, la entrega que
// se confirma después DEBITA 1.1.7.90 (nunca acreditada) → débito huérfano que
// no cierra. El guard bloquea la emisión: exige costo cargado antes de vender.

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("emitir venta — guard de costoPromedio 0 (Onda B #10)", () => {
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
      "ItemVenta",
      "Venta",
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

  async function crearVenta(costoPromedio: string): Promise<string> {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Prod", costoPromedio },
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
        estado: "BORRADOR",
        items: {
          create: [
            {
              productoId: prod.id,
              cantidad: 10,
              precioUnitario: "3000",
              subtotal: "30000",
              iva: "0",
              total: "30000",
            },
          ],
        },
      },
      select: { id: true },
    });
    return venta.id;
  }

  it("rechaza emitir cuando el producto tiene costoPromedio 0 (CMV se omitiría)", async () => {
    const ventaId = await crearVenta("0");
    await expect(crearAsientoVenta(ventaId, db.prisma)).rejects.toMatchObject({
      code: "DOMINIO_INVALIDO",
    });
    // No dejó asiento ni movió 1.1.7.90.
    const venta = await db.prisma.venta.findUniqueOrThrow({ where: { id: ventaId } });
    expect(venta.asientoId).toBeNull();
  });

  it("con costo cargado, emite normal y acredita 1.1.7.90 (CMV provisión)", async () => {
    const ventaId = await crearVenta("1000.00");
    const asiento = await crearAsientoVenta(ventaId, db.prisma);
    expect(asiento).toBeTruthy();
    const haber03 = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: asiento.id, cuenta: { codigo: "1.1.7.90" } },
      select: { haber: true },
    });
    const totalHaber = haber03.reduce((a, l) => a + Number(l.haber), 0);
    expect(totalHaber).toBeCloseTo(10_000, 2);
  });
});
