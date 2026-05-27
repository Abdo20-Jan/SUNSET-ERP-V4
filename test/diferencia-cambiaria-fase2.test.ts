import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Cobertura Fase 2: pago USD contra proveedor USD-nato genera asiento ARS
// misto con 3 líneas (proveedor a TC factura, banco a TC pago, diferencia
// cambiaria automática 4.5.1.01 ganancia o 5.5.3.01 pérdida).

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

import {
  AsientoEstado,
  AsientoOrigen,
  Moneda,
  MovimientoTesoreriaTipo,
  TipoProveedor,
} from "@/generated/prisma/client";
import {
  crearAsientoMovimientoTesoreria,
  calcularDiferenciaCambiariaPago,
} from "@/lib/services/asiento-automatico";

interface Seed {
  cuentaProveedorId: number;
  cuentaBancoArsId: number;
  cuentaBancoUsdId: number;
  cuentaBancariaArsId: string;
  cuentaBancariaUsdId: string;
  proveedorId: string;
  periodoId: number;
}

async function seed(prisma: PrismaClient): Promise<Seed> {
  const periodo = await prisma.periodoContable.create({
    data: {
      numero: 1,
      desde: new Date("2025-01-01T00:00:00.000Z"),
      hasta: new Date("2025-12-31T23:59:59.000Z"),
      estado: "ABIERTO",
    },
  });

  // Cuentas mínimas
  const cuentaProveedor = await prisma.cuentaContable.create({
    data: {
      codigo: "2.1.8.99",
      nombre: "PROVEEDOR USD TEST",
      tipo: "ANALITICA",
      categoria: "PASIVO",
      nivel: 4,
    },
  });
  const cuentaBancoArs = await prisma.cuentaContable.create({
    data: {
      codigo: "1.1.2.01",
      nombre: "BANCO ARS TEST",
      tipo: "ANALITICA",
      categoria: "ACTIVO",
      nivel: 4,
    },
  });
  const cuentaBancoUsd = await prisma.cuentaContable.create({
    data: {
      codigo: "1.1.2.02",
      nombre: "BANCO USD TEST",
      tipo: "ANALITICA",
      categoria: "ACTIVO",
      nivel: 4,
    },
  });
  // Sintética padre para auto-create de diferencia cambio
  await prisma.cuentaContable.createMany({
    data: [
      { codigo: "4", nombre: "INGRESOS", tipo: "SINTETICA", categoria: "INGRESO", nivel: 1 },
      { codigo: "4.5", nombre: "DIF CAMBIO", tipo: "SINTETICA", categoria: "INGRESO", nivel: 2 },
      { codigo: "4.5.1", nombre: "GANANCIA", tipo: "SINTETICA", categoria: "INGRESO", nivel: 3 },
      { codigo: "5", nombre: "EGRESOS", tipo: "SINTETICA", categoria: "EGRESO", nivel: 1 },
      { codigo: "5.5", nombre: "FINANCIEROS", tipo: "SINTETICA", categoria: "EGRESO", nivel: 2 },
      { codigo: "5.5.3", nombre: "PERDIDA", tipo: "SINTETICA", categoria: "EGRESO", nivel: 3 },
    ],
  });

  const proveedor = await prisma.proveedor.create({
    data: {
      nombre: "Sunset Test Corp",
      tipoProveedor: TipoProveedor.MERCADERIA_EXTERIOR,
      monedaOperacion: Moneda.USD,
      pais: "CN",
      cuentaContableId: cuentaProveedor.id,
    },
  });

  const cuentaBancariaArs = await prisma.cuentaBancaria.create({
    data: {
      banco: "Test Bank ARS",
      moneda: Moneda.ARS,
      tipoCuenta: "CUENTA_CORRIENTE",
      cuentaContableId: cuentaBancoArs.id,
      saldoInicial: 1_000_000_000,
    },
  });
  const cuentaBancariaUsd = await prisma.cuentaBancaria.create({
    data: {
      banco: "Test Bank USD",
      moneda: Moneda.USD,
      tipoCuenta: "CUENTA_CORRIENTE",
      cuentaContableId: cuentaBancoUsd.id,
      saldoInicial: 1_000_000,
    },
  });

  return {
    cuentaProveedorId: cuentaProveedor.id,
    cuentaBancoArsId: cuentaBancoArs.id,
    cuentaBancoUsdId: cuentaBancoUsd.id,
    cuentaBancariaArsId: cuentaBancariaArs.id,
    cuentaBancariaUsdId: cuentaBancariaUsd.id,
    proveedorId: proveedor.id,
    periodoId: periodo.id,
  };
}

async function lanzarFacturaUsd(
  prisma: PrismaClient,
  s: Seed,
  usd: number,
  tc: number,
  fecha: Date,
  descripcion = "Factura test",
) {
  const ars = (usd * tc).toFixed(2);
  return prisma.asiento.create({
    data: {
      numero: Math.floor(Math.random() * 100000),
      fecha,
      descripcion,
      estado: AsientoEstado.CONTABILIZADO,
      origen: AsientoOrigen.MANUAL,
      moneda: Moneda.ARS,
      tipoCambio: "1",
      totalDebe: ars,
      totalHaber: ars,
      periodoId: s.periodoId,
      lineas: {
        create: [
          {
            cuentaId: s.cuentaBancoArsId, // contrapartida cualquiera
            debe: ars,
            haber: 0,
            descripcion: "Activo factura",
          },
          {
            cuentaId: s.cuentaProveedorId,
            debe: 0,
            haber: ars,
            descripcion: `${descripcion} — pasivo proveedor`,
            monedaOrigen: Moneda.USD,
            montoOrigen: usd.toFixed(2),
            tipoCambioOrigen: tc.toFixed(6),
          },
        ],
      },
    },
  });
}

async function lanzarPagoUsd(
  prisma: PrismaClient,
  s: Seed,
  usd: number,
  tcPago: number,
  fecha: Date,
  bancoUsd = true,
) {
  return prisma.movimientoTesoreria.create({
    data: {
      fecha,
      tipo: MovimientoTesoreriaTipo.PAGO,
      moneda: Moneda.USD,
      monto: usd.toFixed(2),
      tipoCambio: tcPago.toFixed(6),
      descripcion: `Pago test USD ${usd.toFixed(2)}`,
      cuentaBancariaId: bancoUsd ? s.cuentaBancariaUsdId : s.cuentaBancariaArsId,
      cuentaContableId: s.cuentaProveedorId,
    },
  });
}

describe("Fase 2 — Diferencia cambiaria automática en pago USD", () => {
  let db: TestDb;
  let s: Seed;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  }, 120_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "MovimientoTesoreria",
      "LineaAsiento",
      "Asiento",
      "CuentaBancaria",
      "Proveedor",
      "CuentaContable",
      "PeriodoContable",
    ]);
    s = await seed(db.prisma);
  });

  it("calcula FIFO ponderado entre 2 facturas USD pendientes", async () => {
    await lanzarFacturaUsd(
      db.prisma,
      s,
      10_000,
      1000,
      new Date("2025-06-01T12:00:00.000Z"),
      "Factura A",
    );
    await lanzarFacturaUsd(
      db.prisma,
      s,
      20_000,
      1200,
      new Date("2025-07-01T12:00:00.000Z"),
      "Factura B",
    );

    // Consume 15_000 USD: 10k @ 1000 + 5k @ 1200 → ARS = 10_000_000 + 6_000_000 = 16_000_000
    // TC ponderado = 16_000_000 / 15_000 = 1066,666...
    const r = await calcularDiferenciaCambiariaPago(
      db.prisma as never,
      s.cuentaProveedorId,
      // biome-ignore lint/style/noNonNullAssertion: test helper
      new (await import("decimal.js")).Decimal(15_000),
    );
    expect(r.usdConsumido.toString()).toBe("15000");
    expect(r.arsFactura.toString()).toBe("16000000");
    expect(r.tcPonderado.toFixed(4)).toBe("1066.6667");
  });

  it("genera asiento ARS misto con ganancia cuando TC pago < TC factura", async () => {
    await lanzarFacturaUsd(
      db.prisma,
      s,
      25_397.5,
      1438.5,
      new Date("2025-06-01T12:00:00.000Z"),
    );

    const mov = await lanzarPagoUsd(
      db.prisma,
      s,
      25_397.5,
      1397,
      new Date("2025-06-20T12:00:00.000Z"),
    );

    const asiento = await crearAsientoMovimientoTesoreria(mov.id);
    expect(asiento.moneda).toBe(Moneda.ARS);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: asiento.id },
      include: { cuenta: { select: { codigo: true } } },
      orderBy: { id: "asc" },
    });

    expect(lineas.length).toBe(3);

    // Línea proveedor: DEBE = USD × TC_factura
    const proveedor = lineas.find((l) => l.cuentaId === s.cuentaProveedorId);
    expect(proveedor?.debe.toString()).toBe("36534303.75");
    expect(proveedor?.monedaOrigen).toBe(Moneda.USD);
    expect(proveedor?.montoOrigen?.toString()).toBe("25397.5");

    // Línea banco: HABER = USD × TC_pago
    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoUsdId);
    expect(banco?.haber.toString()).toBe("35480307.5");

    // Línea diferencia: HABER ganancia = spread
    const dif = lineas.find((l) => l.cuenta.codigo === "4.5.1.01");
    expect(dif).toBeDefined();
    expect(dif?.haber.toString()).toBe("1053996.25");
  });

  it("genera asiento ARS misto con pérdida cuando TC pago > TC factura", async () => {
    await lanzarFacturaUsd(db.prisma, s, 10_000, 1000, new Date("2025-06-01T12:00:00.000Z"));

    const mov = await lanzarPagoUsd(
      db.prisma,
      s,
      10_000,
      1100,
      new Date("2025-06-20T12:00:00.000Z"),
    );

    const asiento = await crearAsientoMovimientoTesoreria(mov.id);
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: asiento.id },
      include: { cuenta: { select: { codigo: true } } },
    });

    const dif = lineas.find((l) => l.cuenta.codigo === "5.5.3.01");
    expect(dif).toBeDefined();
    expect(dif?.debe.toString()).toBe("1000000");
  });

  it("no genera línea de diferencia cuando TC pago == TC factura", async () => {
    await lanzarFacturaUsd(db.prisma, s, 5_000, 1300, new Date("2025-06-01T12:00:00.000Z"));

    const mov = await lanzarPagoUsd(db.prisma, s, 5_000, 1300, new Date("2025-06-20T12:00:00.000Z"));
    const asiento = await crearAsientoMovimientoTesoreria(mov.id);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: asiento.id },
    });
    expect(lineas.length).toBe(2);
  });

  it("falla si pago USD excede el saldo USD pendiente", async () => {
    await lanzarFacturaUsd(db.prisma, s, 1_000, 1000, new Date("2025-06-01T12:00:00.000Z"));
    const mov = await lanzarPagoUsd(db.prisma, s, 5_000, 1100, new Date("2025-06-20T12:00:00.000Z"));
    await expect(crearAsientoMovimientoTesoreria(mov.id)).rejects.toThrow(/excede el saldo/);
  });

  it("comportamiento legacy preservado: pago USD sin saldo USD pendiente genera asiento USD de 2 líneas", async () => {
    // Sin lanzar factura — saldo USD pendiente = 0
    const mov = await lanzarPagoUsd(db.prisma, s, 1_000, 1300, new Date("2025-06-20T12:00:00.000Z"));
    const asiento = await crearAsientoMovimientoTesoreria(mov.id);
    expect(asiento.moneda).toBe(Moneda.USD);

    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: asiento.id },
    });
    expect(lineas.length).toBe(2);
  });
});
