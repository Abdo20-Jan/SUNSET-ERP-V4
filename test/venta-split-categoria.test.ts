import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { crearAsientoVenta } from "@/lib/services/asiento-automatico";
import { createTestDb, type TestDb } from "./db";

// Plan ULTRA — split de Ventas y CMV por tipo de neumático.
//
// El motor agrupa las líneas de la venta por `Producto.categoria` y emite un
// crédito de Ventas (4.1.01.0x) y un débito de CMV (5.1.0x) por tipo, en vez
// de una sola cuenta sin desagregar (4.1.01.09 / 5.1.09). La contrapartida de
// inventario (1.1.7.01 / 1.1.7.05) sigue siendo única. El total de cada split
// debe coincidir EXACTO con el subtotal / costo convertido para que el asiento
// cierre (Σdebe = Σhaber), aun con redondeo por grupo (TC ≠ 1).

const FECHA = new Date("2026-05-15T12:00:00.000Z");

describe("Venta — split Ventas/CMV por categoría (ULTRA)", () => {
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
    // Sin stock dual: la contrapartida del CMV es MERCADERÍAS (1.1.7.01) directa
    // y no hace falta entrega — aísla el split del flujo puente.
    process.env.STOCK_DUAL_ENABLED = "false";
    await db.reset([
      "ItemVenta",
      "Venta",
      "LineaAsiento",
      "Asiento",
      "Producto",
      "Cliente",
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

  async function haber(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: { not: "ANULADO" } } },
      select: { haber: true },
    });
    return lineas.reduce((a, l) => a + Number(l.haber), 0);
  }
  async function debe(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: { not: "ANULADO" } } },
      select: { debe: true },
    });
    return lineas.reduce((a, l) => a + Number(l.debe), 0);
  }
  async function balanceaAsiento(asientoId: string) {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      select: { debe: true, haber: true },
    });
    const td = lineas.reduce((a, l) => a + Number(l.debe), 0);
    const th = lineas.reduce((a, l) => a + Number(l.haber), 0);
    return { td, th };
  }

  it("agrupa Ventas y CMV por tipo de neumático (TC = 1)", async () => {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const prodTbr = await db.prisma.producto.create({
      data: { codigo: `TBR-${seq}`, nombre: "TBR", categoria: "TBR", costoPromedio: "100" },
    });
    const prodPcr = await db.prisma.producto.create({
      data: { codigo: `PCR-${seq}`, nombre: "PCR", categoria: "PCR", costoPromedio: "50" },
    });
    const venta = await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId: cli.id,
        fecha: FECHA,
        moneda: "ARS",
        tipoCambio: "1",
        subtotal: "3500",
        iva: "735",
        total: "4235",
        estado: "EMITIDA",
        items: {
          create: [
            {
              productoId: prodTbr.id,
              cantidad: 2,
              precioUnitario: "1000",
              subtotal: "2000",
              iva: "420",
              total: "2420",
            },
            {
              productoId: prodPcr.id,
              cantidad: 3,
              precioUnitario: "500",
              subtotal: "1500",
              iva: "315",
              total: "1815",
            },
          ],
        },
      },
      select: { id: true },
    });

    const asiento = await crearAsientoVenta(venta.id, db.prisma);

    // Ventas: TBR → 4.1.01.01 (2000), PCR → 4.1.01.02 (1500). Nada al fallback.
    expect(await haber("4.1.01.01")).toBeCloseTo(2000, 2);
    expect(await haber("4.1.01.02")).toBeCloseTo(1500, 2);
    expect(await haber("4.1.01.09")).toBeCloseTo(0, 2);

    // CMV: TBR cost 2·100=200 → 5.1.01; PCR cost 3·50=150 → 5.1.02. Nada al fallback.
    expect(await debe("5.1.01")).toBeCloseTo(200, 2);
    expect(await debe("5.1.02")).toBeCloseTo(150, 2);
    expect(await debe("5.1.09")).toBeCloseTo(0, 2);

    // Contrapartida de inventario única (1.1.7.01) = costo total 350.
    expect(await haber("1.1.7.01")).toBeCloseTo(350, 2);

    const { td, th } = await balanceaAsiento(asiento.id);
    expect(td).toBeCloseTo(th, 2);
  });

  it("agrupa dos productos de la MISMA categoría en una sola cuenta", async () => {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const a = await db.prisma.producto.create({
      data: { codigo: `A-${seq}`, nombre: "A", categoria: "TBR", costoPromedio: "100" },
    });
    const b = await db.prisma.producto.create({
      data: { codigo: `B-${seq}`, nombre: "B", categoria: "TBR", costoPromedio: "200" },
    });
    const venta = await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId: cli.id,
        fecha: FECHA,
        moneda: "ARS",
        tipoCambio: "1",
        subtotal: "3000",
        iva: "0",
        total: "3000",
        estado: "EMITIDA",
        items: {
          create: [
            {
              productoId: a.id,
              cantidad: 1,
              precioUnitario: "1000",
              subtotal: "1000",
              iva: "0",
              total: "1000",
            },
            {
              productoId: b.id,
              cantidad: 1,
              precioUnitario: "2000",
              subtotal: "2000",
              iva: "0",
              total: "2000",
            },
          ],
        },
      },
      select: { id: true },
    });

    const asiento = await crearAsientoVenta(venta.id, db.prisma);

    // Las dos líneas TBR se suman en 4.1.01.01 (3000) y 5.1.01 (300).
    expect(await haber("4.1.01.01")).toBeCloseTo(3000, 2);
    expect(await debe("5.1.01")).toBeCloseTo(300, 2);
    const { td, th } = await balanceaAsiento(asiento.id);
    expect(td).toBeCloseTo(th, 2);
  });

  it("conserva el balance con TC ≠ 1 (residual de redondeo al grupo mayor)", async () => {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const tbr = await db.prisma.producto.create({
      data: { codigo: `TBR-${seq}`, nombre: "TBR", categoria: "TBR", costoPromedio: "10" },
    });
    const pcr = await db.prisma.producto.create({
      data: { codigo: `PCR-${seq}`, nombre: "PCR", categoria: "PCR", costoPromedio: "10" },
    });
    // subtotal por ítem 33.33 (USD); TC 1.5 → 49.995 c/u que redondea distinto
    // que el total 66.66·1.5 = 99.99. El split debe sumar EXACTO 99.99.
    const venta = await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId: cli.id,
        fecha: FECHA,
        moneda: "USD",
        tipoCambio: "1.5",
        subtotal: "66.66",
        iva: "0",
        total: "66.66",
        estado: "EMITIDA",
        items: {
          create: [
            {
              productoId: tbr.id,
              cantidad: 1,
              precioUnitario: "33.33",
              subtotal: "33.33",
              iva: "0",
              total: "33.33",
            },
            {
              productoId: pcr.id,
              cantidad: 1,
              precioUnitario: "33.33",
              subtotal: "33.33",
              iva: "0",
              total: "33.33",
            },
          ],
        },
      },
      select: { id: true },
    });

    const asiento = await crearAsientoVenta(venta.id, db.prisma);

    // La suma de los splits de Ventas == subtotal convertido (66.66·1.5 = 99.99).
    const ventasSplit = (await haber("4.1.01.01")) + (await haber("4.1.01.02"));
    expect(ventasSplit).toBeCloseTo(99.99, 2);
    const { td, th } = await balanceaAsiento(asiento.id);
    expect(td).toBeCloseTo(th, 2);
  });

  it("sin categoría reconocida cae al fallback 4.1.01.09 / 5.1.09", async () => {
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const prod = await db.prisma.producto.create({
      data: { codigo: `X-${seq}`, nombre: "Sin categoría", costoPromedio: "100" },
    });
    const venta = await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId: cli.id,
        fecha: FECHA,
        moneda: "ARS",
        tipoCambio: "1",
        subtotal: "1000",
        iva: "0",
        total: "1000",
        estado: "EMITIDA",
        items: {
          create: [
            {
              productoId: prod.id,
              cantidad: 1,
              precioUnitario: "1000",
              subtotal: "1000",
              iva: "0",
              total: "1000",
            },
          ],
        },
      },
      select: { id: true },
    });

    const asiento = await crearAsientoVenta(venta.id, db.prisma);

    expect(await haber("4.1.01.09")).toBeCloseTo(1000, 2);
    expect(await debe("5.1.09")).toBeCloseTo(100, 2);
    const { td, th } = await balanceaAsiento(asiento.id);
    expect(td).toBeCloseTo(th, 2);
  });

  it("NO provisiona Impuesto a las Ganancias por venta (se calcula al cierre, no por operación)", async () => {
    // Decisión 2026-06-17: el ERP es razón gerencial; el Impuesto a las Ganancias
    // se determina al cierre (lucro neto del ejercicio × escala 25/30/35), no por
    // operación. Provisionar 35% fijo sobre la utilidad bruta de cada venta crea
    // un pasivo falso (2.1.3.3.01) y distorsiona la rentabilidad — el asiento de
    // venta NO debe tocar 8.9.01 ni 2.1.3.3.01.
    const cli = await db.prisma.cliente.create({ data: { nombre: `Cli ${seq}` } });
    const prod = await db.prisma.producto.create({
      data: { codigo: `TBR-${seq}`, nombre: "TBR", categoria: "TBR", costoPromedio: "100" },
    });
    const venta = await db.prisma.venta.create({
      data: {
        numero: `V-${seq}`,
        clienteId: cli.id,
        fecha: FECHA,
        moneda: "ARS",
        tipoCambio: "1",
        subtotal: "2000",
        iva: "0",
        total: "2000",
        estado: "EMITIDA",
        items: {
          create: [
            {
              productoId: prod.id,
              cantidad: 2,
              precioUnitario: "1000",
              subtotal: "2000",
              iva: "0",
              total: "2000",
            },
          ],
        },
      },
      select: { id: true },
    });

    const asiento = await crearAsientoVenta(venta.id, db.prisma);

    // Venta rentable (utilidad bruta 1800): el motor viejo habría provisionado
    // 0.35·1800 = 630. Ahora NO hay línea de provisión.
    expect(await debe("8.9.01")).toBeCloseTo(0, 2);
    expect(await haber("2.1.3.3.01")).toBeCloseTo(0, 2);
    const { td, th } = await balanceaAsiento(asiento.id);
    expect(td).toBeCloseTo(th, 2);
  });
});
