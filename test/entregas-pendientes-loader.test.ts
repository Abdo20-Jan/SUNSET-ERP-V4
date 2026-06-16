import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cargarVentasConEntregaPendiente } from "@/lib/services/entregas-pendientes-loader";
import { createTestDb, type TestDb } from "./db";

// Hub de entregas: lista las ventas EMITIDA cuyo despacho físico (remito
// CONFIRMADA) aún no cubre todo lo vendido. Un BORRADOR NO cuenta como
// entregado (la cuenta-puente 1.1.5.03 sigue abierta hasta confirmar), pero
// se reporta para que el usuario sepa que sólo falta confirmarlo.

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("cargarVentasConEntregaPendiente (integración)", () => {
  let db: TestDb;
  let depId: string;
  let clienteId: string;
  let productoId: string;
  let seq = 0;

  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    seq += 1;
    await db.reset([
      "ItemEntrega",
      "EntregaVenta",
      "ItemVenta",
      "Venta",
      "Producto",
      "Cliente",
      "Deposito",
    ]);
    const dep = await db.prisma.deposito.create({
      data: { nombre: "NACIONAL", tipo: "NACIONAL", activo: true },
    });
    depId = dep.id;
    const cli = await db.prisma.cliente.create({ data: { nombre: "Cliente Test" } });
    clienteId = cli.id;
    const prod = await db.prisma.producto.create({
      data: { codigo: `P-${seq}`, nombre: "Producto" },
    });
    productoId = prod.id;
  });

  async function crearVenta(
    numero: string,
    estado: "EMITIDA" | "BORRADOR",
    cantidad: number,
  ): Promise<{ ventaId: string; itemId: number }> {
    const venta = await db.prisma.venta.create({
      data: {
        numero,
        clienteId,
        fecha: FECHA,
        moneda: "ARS",
        subtotal: "0",
        iva: "0",
        total: "0",
        estado,
        items: {
          create: [
            {
              productoId,
              cantidad,
              precioUnitario: "1000",
              subtotal: "0",
              iva: "0",
              total: "0",
              depositoId: depId,
            },
          ],
        },
      },
      select: { id: true, items: { select: { id: true } } },
    });
    return { ventaId: venta.id, itemId: venta.items[0].id };
  }

  async function crearEntrega(
    numero: string,
    ventaId: string,
    itemId: number,
    cantidad: number,
    estado: "BORRADOR" | "CONFIRMADA" | "ANULADA",
  ): Promise<void> {
    await db.prisma.entregaVenta.create({
      data: {
        numero,
        ventaId,
        depositoId: depId,
        fecha: FECHA,
        estado,
        items: { create: [{ itemVentaId: itemId, cantidad, costoUnitario: "0" }] },
      },
    });
  }

  it("incluye solo ventas EMITIDA con pendiente físico (CONFIRMADA cuenta, BORRADOR no)", async () => {
    // A: emitida, sin entregas → pendiente 10
    const a = await crearVenta("A", "EMITIDA", 10);
    // B: emitida, CONFIRMADA 5 de 5 → sin pendiente, excluida
    const b = await crearVenta("B", "EMITIDA", 5);
    await crearEntrega("E-B", b.ventaId, b.itemId, 5, "CONFIRMADA");
    // C: emitida, BORRADOR 8 de 8 (sin confirmar) → pendiente 8, nBorrador 1
    const c = await crearVenta("C", "EMITIDA", 8);
    await crearEntrega("E-C", c.ventaId, c.itemId, 8, "BORRADOR");
    // D: BORRADOR (no emitida) → excluida
    await crearVenta("D", "BORRADOR", 4);
    // E: emitida, CONFIRMADA parcial 4 de 6 → pendiente 2
    const e = await crearVenta("E", "EMITIDA", 6);
    await crearEntrega("E-E", e.ventaId, e.itemId, 4, "CONFIRMADA");
    // F: emitida, ANULADA 3 de 3 → la anulada no cuenta, pendiente 3
    const f = await crearVenta("F", "EMITIDA", 3);
    await crearEntrega("E-F", f.ventaId, f.itemId, 3, "ANULADA");

    const filas = await cargarVentasConEntregaPendiente(db.prisma);
    const porNumero = new Map(filas.map((x) => [x.numero, x]));

    expect(new Set(filas.map((x) => x.numero))).toEqual(new Set(["A", "C", "E", "F"]));
    expect(porNumero.get("A")?.unidadesPendientes).toBe(10);
    expect(porNumero.get("A")?.nBorrador).toBe(0);
    expect(porNumero.get("C")?.unidadesPendientes).toBe(8);
    expect(porNumero.get("C")?.nBorrador).toBe(1);
    expect(porNumero.get("E")?.unidadesPendientes).toBe(2);
    expect(porNumero.get("E")?.nConfirmadas).toBe(1);
    expect(porNumero.get("F")?.unidadesPendientes).toBe(3);
    expect(porNumero.get("A")?.clienteNombre).toBe("Cliente Test");
  });

  it("retorna vacío cuando no hay ventas pendientes", async () => {
    const b = await crearVenta("SOLO", "EMITIDA", 2);
    await crearEntrega("E-SOLO", b.ventaId, b.itemId, 2, "CONFIRMADA");
    const filas = await cargarVentasConEntregaPendiente(db.prisma);
    expect(filas).toEqual([]);
  });
});
