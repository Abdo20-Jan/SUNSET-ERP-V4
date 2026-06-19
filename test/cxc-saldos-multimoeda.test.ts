import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Cuentas a cobrar — saldo USD nativo (monedaOrigen=USD, invariante a TC) +
// montoNativo por venta (pendiente revertido por el TC de emisión). Verifica
// que el agregado multimoneda no usa ÷tc ciego: la parte USD-nata se expone
// como saldoUsd/saldoTotalUsd y cada venta lleva su pendiente nativo.

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

import { getCuentasACobrar, getSaldosPorClienteConAging } from "@/lib/services/cuentas-a-cobrar";

const FECHA = new Date("2025-06-15T12:00:00.000Z");
const VENC = new Date("2025-07-15T12:00:00.000Z");
const TC = "1200.000000";

describe("cuentas a cobrar — saldo USD nativo + montoNativo", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "LineaAsiento",
      "Asiento",
      "ItemVenta",
      "Venta",
      "Cliente",
      "PeriodoContable",
      "CuentaContable",
    ]);
  });

  async function seedBase() {
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
    const cuentaCliente = await db.prisma.cuentaContable.create({
      data: {
        codigo: "1.1.3.01",
        nombre: "CLIENTE",
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const cuentaVentas = await db.prisma.cuentaContable.create({
      data: {
        codigo: "4.1.1.01",
        nombre: "VENTAS",
        tipo: "ANALITICA",
        categoria: "INGRESO",
        nivel: 4,
      },
    });
    const cliente = await db.prisma.cliente.create({
      data: { nombre: "CLIENTE", cuentaContableId: cuentaCliente.id },
    });
    return { periodo, cuentaCliente, cuentaVentas, cliente };
  }

  async function crearAsientoVenta(opts: {
    periodoId: number;
    cuentaClienteId: number;
    cuentaVentasId: number;
    debeArs: string;
    usd?: string;
    numero: number;
    descripcion: string;
  }) {
    return db.prisma.asiento.create({
      data: {
        numero: opts.numero,
        fecha: FECHA,
        descripcion: opts.descripcion,
        estado: "CONTABILIZADO",
        origen: "MANUAL",
        moneda: "ARS",
        tipoCambio: "1",
        totalDebe: opts.debeArs,
        totalHaber: opts.debeArs,
        periodoId: opts.periodoId,
        lineas: {
          create: [
            {
              cuentaId: opts.cuentaClienteId,
              debe: opts.debeArs,
              haber: 0,
              descripcion: opts.descripcion,
              ...(opts.usd
                ? { monedaOrigen: "USD", montoOrigen: opts.usd, tipoCambioOrigen: TC }
                : {}),
            },
            { cuentaId: opts.cuentaVentasId, debe: 0, haber: opts.debeArs, descripcion: "Ventas" },
          ],
        },
      },
    });
  }

  it("getCuentasACobrar: cliente con líneas USD → saldoUsd presente + totalGeneralUsd", async () => {
    const b = await seedBase();
    await crearAsientoVenta({
      periodoId: b.periodo.id,
      cuentaClienteId: b.cuentaCliente.id,
      cuentaVentasId: b.cuentaVentas.id,
      debeArs: "1200000.00",
      usd: "1000.00",
      numero: 1,
      descripcion: "Venta USD V-0001",
    });

    const data = await getCuentasACobrar();
    const row = data.clientes.find((c) => c.cuentaCodigo === "1.1.3.01");
    expect(row).toBeDefined();
    expect(row?.saldo).toBe("1200000.00");
    expect(row?.saldoUsd).toBe("1000.00"); // neto DEBE−HABER de montoOrigen USD
  });

  it("getCuentasACobrar: cliente solo-ARS → saldoUsd ausente, totalGeneralUsd 0", async () => {
    const b = await seedBase();
    await crearAsientoVenta({
      periodoId: b.periodo.id,
      cuentaClienteId: b.cuentaCliente.id,
      cuentaVentasId: b.cuentaVentas.id,
      debeArs: "500000.00",
      numero: 2,
      descripcion: "Venta ARS V-0002",
    });

    const data = await getCuentasACobrar();
    const row = data.clientes.find((c) => c.cuentaCodigo === "1.1.3.01");
    expect(row?.saldo).toBe("500000.00");
    expect(row?.saldoUsd).toBeUndefined();
  });

  it("getSaldosPorClienteConAging: venta USD → saldoTotalUsd + montoNativo (÷TC emisión)", async () => {
    const b = await seedBase();
    await db.prisma.venta.create({
      data: {
        numero: "V-0001",
        clienteId: b.cliente.id,
        fecha: FECHA,
        fechaVencimiento: VENC,
        moneda: "USD",
        tipoCambio: TC,
        subtotal: "1000.00",
        iva: "0",
        total: "1000.00",
        estado: "EMITIDA",
      },
    });
    await crearAsientoVenta({
      periodoId: b.periodo.id,
      cuentaClienteId: b.cuentaCliente.id,
      cuentaVentasId: b.cuentaVentas.id,
      debeArs: "1200000.00",
      usd: "1000.00",
      numero: 1,
      descripcion: "Venta USD V-0001",
    });

    const ag = await getSaldosPorClienteConAging();
    const cli = ag.find((c) => c.clienteId === b.cliente.id);
    expect(cli).toBeDefined();
    expect(cli?.saldoTotal).toBe("1200000.00"); // contable ARS (la verdad)
    expect(cli?.saldoTotalUsd).toBe("1000.00"); // USD nativo via monedaOrigen
    const venta = cli?.ventas.find((v) => v.numero === "V-0001");
    expect(venta?.moneda).toBe("USD");
    expect(venta?.monto).toBe("1200000.00"); // ARS legado
    expect(venta?.montoNativo).toBe("1000.00"); // 1.200.000 / 1200
  });

  it("getSaldosPorClienteConAging: venta ARS → montoNativo == monto (passthrough)", async () => {
    const b = await seedBase();
    await db.prisma.venta.create({
      data: {
        numero: "V-0003",
        clienteId: b.cliente.id,
        fecha: FECHA,
        fechaVencimiento: VENC,
        moneda: "ARS",
        tipoCambio: "1",
        subtotal: "500000.00",
        iva: "0",
        total: "500000.00",
        estado: "EMITIDA",
      },
    });
    await crearAsientoVenta({
      periodoId: b.periodo.id,
      cuentaClienteId: b.cuentaCliente.id,
      cuentaVentasId: b.cuentaVentas.id,
      debeArs: "500000.00",
      numero: 3,
      descripcion: "Venta ARS V-0003",
    });

    const ag = await getSaldosPorClienteConAging();
    const cli = ag.find((c) => c.clienteId === b.cliente.id);
    expect(cli?.saldoTotalUsd).toBeUndefined();
    const venta = cli?.ventas.find((v) => v.numero === "V-0003");
    expect(venta?.moneda).toBe("ARS");
    expect(venta?.montoNativo).toBe("500000.00");
  });
});
