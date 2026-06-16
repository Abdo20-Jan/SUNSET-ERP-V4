import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearEntregaBorradorPorDefecto } from "@/lib/services/entrega-borrador";
import { createTestDb, type TestDb } from "./db";

// Auto-criação de entrega BORRADOR ao emitir venta (stock-dual ON):
// uma EntregaVenta BORRADOR por depósito, com 100% de cada ItemVenta, sem
// mover stock nem gerar asiento. Idempotente. Torna a entrega visível/pendente
// para que a ponte 1.1.5.03 não acumule esquecida.

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("crearEntregaBorradorPorDefecto", () => {
  let db: TestDb;
  let seq = 0;
  let depNacionalId: string;
  let depSecundarioId: string;
  let productoAId: string;
  let productoBId: string;
  let clienteId: string;

  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    seq += 1;
    await db.reset([
      "ItemEntrega",
      "EntregaVenta",
      "ItemVenta",
      "Venta",
      "StockPorDeposito",
      "Producto",
      "Cliente",
      "Deposito",
    ]);
    const dep1 = await db.prisma.deposito.create({
      data: { nombre: "NACIONAL", tipo: "NACIONAL", activo: true },
    });
    depNacionalId = dep1.id;
    const dep2 = await db.prisma.deposito.create({
      data: { nombre: "SUCURSAL", tipo: "NACIONAL", activo: true },
    });
    depSecundarioId = dep2.id;
    const pa = await db.prisma.producto.create({
      data: { codigo: `PA-${seq}`, nombre: "Prod A" },
    });
    productoAId = pa.id;
    const pb = await db.prisma.producto.create({
      data: { codigo: `PB-${seq}`, nombre: "Prod B" },
    });
    productoBId = pb.id;
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cliente ${seq}` } });
    clienteId = cli.id;
  });

  async function crearVentaConItems(
    items: { productoId: string; cantidad: number; depositoId: string | null }[],
  ): Promise<string> {
    const venta = await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId,
        fecha: FECHA,
        moneda: "ARS",
        subtotal: "0",
        iva: "0",
        total: "0",
        estado: "EMITIDA",
        items: {
          create: items.map((it) => ({
            productoId: it.productoId,
            cantidad: it.cantidad,
            precioUnitario: "1000",
            subtotal: "0",
            iva: "0",
            total: "0",
            depositoId: it.depositoId,
          })),
        },
      },
      select: { id: true },
    });
    return venta.id;
  }

  it("cria 1 entrega BORRADOR com 100% dos itens (mesmo depósito)", async () => {
    const ventaId = await crearVentaConItems([
      { productoId: productoAId, cantidad: 5, depositoId: depNacionalId },
      { productoId: productoBId, cantidad: 3, depositoId: depNacionalId },
    ]);

    const creadas = await db.prisma.$transaction((tx) =>
      crearEntregaBorradorPorDefecto(tx, ventaId, FECHA),
    );
    expect(creadas).toHaveLength(1);

    const entregas = await db.prisma.entregaVenta.findMany({
      where: { ventaId },
      include: { items: true },
    });
    expect(entregas).toHaveLength(1);
    expect(entregas[0].estado).toBe("BORRADOR");
    expect(entregas[0].asientoId).toBeNull();
    expect(entregas[0].depositoId).toBe(depNacionalId);
    expect(entregas[0].items).toHaveLength(2);
    const cantidades = entregas[0].items.map((i) => i.cantidad).sort((a, b) => a - b);
    expect(cantidades).toEqual([3, 5]);
    expect(entregas[0].items.every((i) => Number(i.costoUnitario) === 0)).toBe(true);
  });

  it("é idempotente: segunda chamada não cria entrega nova", async () => {
    const ventaId = await crearVentaConItems([
      { productoId: productoAId, cantidad: 5, depositoId: depNacionalId },
    ]);
    await db.prisma.$transaction((tx) => crearEntregaBorradorPorDefecto(tx, ventaId, FECHA));
    const segunda = await db.prisma.$transaction((tx) =>
      crearEntregaBorradorPorDefecto(tx, ventaId, FECHA),
    );
    expect(segunda).toHaveLength(0);
    expect(await db.prisma.entregaVenta.count({ where: { ventaId } })).toBe(1);
  });

  it("agrupa por depósito: itens em 2 depósitos → 2 entregas", async () => {
    const ventaId = await crearVentaConItems([
      { productoId: productoAId, cantidad: 5, depositoId: depNacionalId },
      { productoId: productoBId, cantidad: 3, depositoId: depSecundarioId },
    ]);
    const creadas = await db.prisma.$transaction((tx) =>
      crearEntregaBorradorPorDefecto(tx, ventaId, FECHA),
    );
    expect(creadas).toHaveLength(2);
    const entregas = await db.prisma.entregaVenta.findMany({
      where: { ventaId },
      select: { depositoId: true },
    });
    expect(new Set(entregas.map((e) => e.depositoId))).toEqual(
      new Set([depNacionalId, depSecundarioId]),
    );
  });

  it("itens sem depósito caem no NACIONAL por defecto", async () => {
    const ventaId = await crearVentaConItems([
      { productoId: productoAId, cantidad: 2, depositoId: null },
    ]);
    await db.prisma.$transaction((tx) => crearEntregaBorradorPorDefecto(tx, ventaId, FECHA));
    const entrega = await db.prisma.entregaVenta.findFirstOrThrow({ where: { ventaId } });
    expect(entrega.depositoId).toBe(depNacionalId);
  });
});
