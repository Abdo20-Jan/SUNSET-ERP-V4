import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Decisión contador #4 (PR #2) — Aplicación de un anticipo a proveedor contra
// una factura (Compra/Gasto). El anticipo es un ACTIVO (dinero a cuenta); al
// llegar la factura, aplicarlo CANCELA parte del pasivo del proveedor y BAJA el
// activo:  DEBE pasivo-proveedor (2.1.1.0x)  /  HABER cuenta-anticipo (1.1.7.07
// bien | 1.1.5.01 servicio).  Baja saldoAplicadoArs; al consumir todo el saldo
// el anticipo pasa a APLICADO_TOTAL.  Anular revierte el asiento del registro
// (DEBE anticipo / HABER banco) → el saldo del banco vuelve.

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
  anularAnticipoProveedorAction,
  aplicarAnticipoProveedorAction,
  registrarAnticipoProveedorAction,
} from "@/lib/actions/anticipos-proveedor";

interface Seed {
  proveedorAId: string;
  proveedorBId: string;
  cuentaBancariaId: string;
  cuentaBancoCodigo: string;
  cuentaPasivoACodigo: string;
  cuentaAnticipoBienesId: number;
  cuentaAnticipoServiciosId: number;
}

describe("Anticipo a proveedor — aplicación + anulación (PR #2)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.reset([
      "AplicacionAnticipoProveedor",
      "AnticipoProveedor",
      "ItemCompra",
      "Compra",
      "LineaGasto",
      "Gasto",
      "MovimientoTesoreria",
      "LineaAsiento",
      "Asiento",
      "CuentaBancaria",
      "Proveedor",
      "PeriodoContable",
      "CuentaContable",
    ]);
  });

  async function seed(): Promise<Seed> {
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2026-06",
        nombre: "Junio 2026",
        fechaInicio: new Date("2026-06-01T00:00:00.000Z"),
        fechaFin: new Date("2026-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });

    const mkCuenta = (codigo: string, nombre: string, categoria: "ACTIVO" | "PASIVO") =>
      db.prisma.cuentaContable.create({
        data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4 },
      });

    const cuentaBanco = await mkCuenta("1.1.1.02.01", "BANCO SANTANDER ARS", "ACTIVO");
    const anticipoBienes = await mkCuenta(
      "1.1.7.07",
      "ANTICIPOS A PROVEEDORES DE BIENES DE CAMBIO",
      "ACTIVO",
    );
    const anticipoServicios = await mkCuenta(
      "1.1.5.01",
      "ANTICIPOS A PROVEEDORES DE SERVICIOS",
      "ACTIVO",
    );
    const pasivoA = await mkCuenta("2.1.1.01.05", "PROVEEDOR LOCAL A SA", "PASIVO");
    const pasivoB = await mkCuenta("2.1.1.01.06", "PROVEEDOR LOCAL B SA", "PASIVO");

    const cuentaBancaria = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Santander",
        tipo: "CUENTA_CORRIENTE",
        moneda: "ARS",
        numero: "0001-0001",
        cuentaContableId: cuentaBanco.id,
      },
    });

    const proveedorA = await db.prisma.proveedor.create({
      data: {
        nombre: "Proveedor Local A SA",
        tipoProveedor: "MERCADERIA_LOCAL",
        cuentaContableId: pasivoA.id,
      },
    });
    const proveedorB = await db.prisma.proveedor.create({
      data: {
        nombre: "Proveedor Local B SA",
        tipoProveedor: "MERCADERIA_LOCAL",
        cuentaContableId: pasivoB.id,
      },
    });

    return {
      proveedorAId: proveedorA.id,
      proveedorBId: proveedorB.id,
      cuentaBancariaId: cuentaBancaria.id,
      cuentaBancoCodigo: "1.1.1.02.01",
      cuentaPasivoACodigo: "2.1.1.01.05",
      cuentaAnticipoBienesId: anticipoBienes.id,
      cuentaAnticipoServiciosId: anticipoServicios.id,
    };
  }

  let compraSeq = 0;
  async function crearCompra(
    proveedorId: string,
    total: string,
    estado: "BORRADOR" | "EMITIDA" = "EMITIDA",
  ): Promise<string> {
    compraSeq += 1;
    const compra = await db.prisma.compra.create({
      data: {
        numero: `COMP-${compraSeq}`,
        proveedorId,
        fecha: new Date("2026-06-12T00:00:00.000Z"),
        moneda: "ARS",
        subtotal: total,
        iva: "0",
        total,
        estado,
      },
    });
    return compra.id;
  }

  let gastoSeq = 0;
  async function crearGasto(proveedorId: string, total: string): Promise<string> {
    gastoSeq += 1;
    const gasto = await db.prisma.gasto.create({
      data: {
        numero: `GAS-${gastoSeq}`,
        proveedorId,
        fecha: new Date("2026-06-12T00:00:00.000Z"),
        moneda: "ARS",
        subtotal: total,
        total,
        estado: "CONTABILIZADO",
      },
    });
    return gasto.id;
  }

  async function registrarAnticipo(
    s: Seed,
    cuentaContableId: number,
    monto: string,
    proveedorId = s.proveedorAId,
  ): Promise<{ anticipoId: string }> {
    const r = await registrarAnticipoProveedorAction({
      proveedorId,
      cuentaContableId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: "2026-06-10",
      monto,
    });
    if (!r.ok) throw new Error(`registro falló: ${r.error}`);
    return { anticipoId: r.anticipoId };
  }

  async function saldoCuenta(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: "CONTABILIZADO" } },
      select: { debe: true, haber: true },
    });
    return lineas.reduce((acc, l) => acc + Number(l.debe) - Number(l.haber), 0);
  }

  async function lineasDelAsiento(asientoId: string) {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true } } },
    });
    const debe = (codigo: string) =>
      lineas.filter((l) => l.cuenta.codigo === codigo).reduce((acc, l) => acc + Number(l.debe), 0);
    const haber = (codigo: string) =>
      lineas.filter((l) => l.cuenta.codigo === codigo).reduce((acc, l) => acc + Number(l.haber), 0);
    const totalDebe = lineas.reduce((acc, l) => acc + Number(l.debe), 0);
    const totalHaber = lineas.reduce((acc, l) => acc + Number(l.haber), 0);
    return { debe, haber, totalDebe, totalHaber };
  }

  it("aplica parcialmente: DEBE pasivo-proveedor / HABER cuenta-anticipo; baja saldo; queda VIGENTE", async () => {
    const s = await seed();
    const { anticipoId } = await registrarAnticipo(s, s.cuentaAnticipoBienesId, "150000.00");
    const compraId = await crearCompra(s.proveedorAId, "200000.00");

    const r = await aplicarAnticipoProveedorAction({
      anticipoId,
      compraId,
      montoArs: "100000.00",
      fecha: "2026-06-15",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const a = await lineasDelAsiento(r.asientoId);
    expect(a.debe(s.cuentaPasivoACodigo)).toBeCloseTo(100000, 2);
    expect(a.haber("1.1.7.07")).toBeCloseTo(100000, 2);
    expect(a.totalDebe).toBeCloseTo(a.totalHaber, 2);

    const anticipo = await db.prisma.anticipoProveedor.findUniqueOrThrow({
      where: { id: anticipoId },
    });
    expect(Number(anticipo.saldoAplicadoArs)).toBeCloseTo(100000, 2);
    expect(anticipo.estado).toBe("VIGENTE");

    const apls = await db.prisma.aplicacionAnticipoProveedor.findMany({ where: { anticipoId } });
    expect(apls).toHaveLength(1);
    expect(apls[0]?.compraId).toBe(compraId);
    expect(apls[0]?.gastoId).toBeNull();
    expect(Number(apls[0]?.montoArs)).toBeCloseTo(100000, 2);
    expect(apls[0]?.asientoId).toBeTruthy();
  });

  it("aplicación que consume todo el saldo → APLICADO_TOTAL", async () => {
    const s = await seed();
    const { anticipoId } = await registrarAnticipo(s, s.cuentaAnticipoBienesId, "150000.00");
    const compraId = await crearCompra(s.proveedorAId, "200000.00");

    const r = await aplicarAnticipoProveedorAction({
      anticipoId,
      compraId,
      montoArs: "150000.00",
      fecha: "2026-06-15",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const anticipo = await db.prisma.anticipoProveedor.findUniqueOrThrow({
      where: { id: anticipoId },
    });
    expect(Number(anticipo.saldoAplicadoArs)).toBeCloseTo(150000, 2);
    expect(anticipo.estado).toBe("APLICADO_TOTAL");
  });

  it("rechaza aplicar más que el saldo pendiente del anticipo", async () => {
    const s = await seed();
    const { anticipoId } = await registrarAnticipo(s, s.cuentaAnticipoBienesId, "150000.00");
    const compraId = await crearCompra(s.proveedorAId, "500000.00");

    const r = await aplicarAnticipoProveedorAction({
      anticipoId,
      compraId,
      montoArs: "200000.00",
      fecha: "2026-06-15",
    });
    expect(r.ok).toBe(false);

    expect(await db.prisma.aplicacionAnticipoProveedor.count()).toBe(0);
    const anticipo = await db.prisma.anticipoProveedor.findUniqueOrThrow({
      where: { id: anticipoId },
    });
    expect(Number(anticipo.saldoAplicadoArs)).toBeCloseTo(0, 2);
    expect(anticipo.estado).toBe("VIGENTE");
  });

  it("rechaza aplicar a una factura de OTRO proveedor", async () => {
    const s = await seed();
    const { anticipoId } = await registrarAnticipo(s, s.cuentaAnticipoBienesId, "150000.00");
    const compraOtroId = await crearCompra(s.proveedorBId, "200000.00");

    const r = await aplicarAnticipoProveedorAction({
      anticipoId,
      compraId: compraOtroId,
      montoArs: "50000.00",
      fecha: "2026-06-15",
    });
    expect(r.ok).toBe(false);
    expect(await db.prisma.aplicacionAnticipoProveedor.count()).toBe(0);
  });

  it("rechaza aplicar un anticipo no vigente (ya APLICADO_TOTAL)", async () => {
    const s = await seed();
    const { anticipoId } = await registrarAnticipo(s, s.cuentaAnticipoBienesId, "150000.00");
    const compraId = await crearCompra(s.proveedorAId, "500000.00");

    const r1 = await aplicarAnticipoProveedorAction({
      anticipoId,
      compraId,
      montoArs: "150000.00",
      fecha: "2026-06-15",
    });
    expect(r1.ok).toBe(true);

    const r2 = await aplicarAnticipoProveedorAction({
      anticipoId,
      compraId,
      montoArs: "1.00",
      fecha: "2026-06-15",
    });
    expect(r2.ok).toBe(false);
    expect(await db.prisma.aplicacionAnticipoProveedor.count()).toBe(1);
  });

  it("aplica contra un Gasto (no sólo Compra): servicio debita pasivo / acredita 1.1.5.01", async () => {
    const s = await seed();
    const { anticipoId } = await registrarAnticipo(s, s.cuentaAnticipoServiciosId, "80000.00");
    const gastoId = await crearGasto(s.proveedorAId, "100000.00");

    const r = await aplicarAnticipoProveedorAction({
      anticipoId,
      gastoId,
      montoArs: "80000.00",
      fecha: "2026-06-15",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const a = await lineasDelAsiento(r.asientoId);
    expect(a.debe(s.cuentaPasivoACodigo)).toBeCloseTo(80000, 2);
    expect(a.haber("1.1.5.01")).toBeCloseTo(80000, 2);

    const apls = await db.prisma.aplicacionAnticipoProveedor.findMany({ where: { anticipoId } });
    expect(apls).toHaveLength(1);
    expect(apls[0]?.gastoId).toBe(gastoId);
    expect(apls[0]?.compraId).toBeNull();

    const anticipo = await db.prisma.anticipoProveedor.findUniqueOrThrow({
      where: { id: anticipoId },
    });
    expect(anticipo.estado).toBe("APLICADO_TOTAL");
  });

  it("anula un anticipo vigente sin aplicaciones: asiento ANULADO y el saldo del banco vuelve a 0", async () => {
    const s = await seed();
    const { anticipoId } = await registrarAnticipo(s, s.cuentaAnticipoBienesId, "150000.00");

    // Tras el registro, el banco quedó debitado en HABER (saldo −150000).
    expect(await saldoCuenta(s.cuentaBancoCodigo)).toBeCloseTo(-150000, 2);

    const r = await anularAnticipoProveedorAction({ anticipoId });
    expect(r.ok).toBe(true);

    const anticipo = await db.prisma.anticipoProveedor.findUniqueOrThrow({
      where: { id: anticipoId },
    });
    expect(anticipo.estado).toBe("ANULADO");
    // El asiento del registro quedó ANULADO → su HABER al banco ya no cuenta.
    expect(await saldoCuenta(s.cuentaBancoCodigo)).toBeCloseTo(0, 2);
    expect(await saldoCuenta("1.1.7.07")).toBeCloseTo(0, 2);
  });

  it("rechaza anular un anticipo con aplicaciones", async () => {
    const s = await seed();
    const { anticipoId } = await registrarAnticipo(s, s.cuentaAnticipoBienesId, "150000.00");
    const compraId = await crearCompra(s.proveedorAId, "200000.00");

    const apl = await aplicarAnticipoProveedorAction({
      anticipoId,
      compraId,
      montoArs: "50000.00",
      fecha: "2026-06-15",
    });
    expect(apl.ok).toBe(true);

    const r = await anularAnticipoProveedorAction({ anticipoId });
    expect(r.ok).toBe(false);

    const anticipo = await db.prisma.anticipoProveedor.findUniqueOrThrow({
      where: { id: anticipoId },
    });
    expect(anticipo.estado).toBe("VIGENTE");
  });
});
