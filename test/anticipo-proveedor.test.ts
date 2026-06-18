import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Decisión contador #4 — Anticipo a proveedor LOCAL (bienes vs servicios).
// Registrar un adelanto a proveedor SIN factura previa: el egreso de caja es un
// MovimientoTesoreria PAGO cuya contrapartida DEBE es la cuenta de anticipo
// elegida vía drilldown del plan. La cuenta codifica la clasificación:
//   - BIEN     → 1.1.7.07 (Anticipos a proveedores de bienes de cambio)
//   - SERVICIO → 1.1.5.01 (Anticipos a proveedores de servicios)
// El anticipo nace VIGENTE con saldoAplicadoArs = 0 (la aplicación es PR #2).

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
  listarCuentasAnticipoProveedor,
  registrarAnticipoProveedorAction,
} from "@/lib/actions/anticipos-proveedor";

interface Seed {
  proveedorId: string;
  cuentaBancariaId: string;
  cuentaBancoContableId: number;
  cuentaAnticipoBienesId: number;
  cuentaAnticipoServiciosId: number;
  cuentaGastoId: number;
}

describe("Anticipo a proveedor — registro (PR #1)", () => {
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

    const mkCuenta = (
      codigo: string,
      nombre: string,
      categoria: "ACTIVO" | "PASIVO" | "EGRESO",
      padreCodigo?: string,
    ) =>
      db.prisma.cuentaContable.create({
        data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4, padreCodigo },
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
    // Cuenta NO-anticipo (un gasto), para validar que el drilldown la excluye
    // y que la action rechaza registrar un anticipo contra ella.
    const cuentaGasto = await mkCuenta("7.9.99", "OTROS GASTOS", "EGRESO");

    const cuentaBancaria = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Santander",
        tipo: "CUENTA_CORRIENTE",
        moneda: "ARS",
        numero: "0001-0001",
        cuentaContableId: cuentaBanco.id,
      },
    });

    const proveedor = await db.prisma.proveedor.create({
      data: { nombre: "Proveedor Local SA", tipoProveedor: "MERCADERIA_LOCAL" },
    });

    return {
      proveedorId: proveedor.id,
      cuentaBancariaId: cuentaBancaria.id,
      cuentaBancoContableId: cuentaBanco.id,
      cuentaAnticipoBienesId: anticipoBienes.id,
      cuentaAnticipoServiciosId: anticipoServicios.id,
      cuentaGastoId: cuentaGasto.id,
    };
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
    return { debe, haber, totalDebe, totalHaber, lineas };
  }

  it("anticipo de BIEN debita 1.1.7.07 y acredita el banco; nace VIGENTE", async () => {
    const s = await seed();

    const r = await registrarAnticipoProveedorAction({
      proveedorId: s.proveedorId,
      cuentaContableId: s.cuentaAnticipoBienesId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: "2026-06-10",
      monto: "150000.00",
      descripcion: "Anticipo compra neumáticos",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const a = await lineasDelAsiento(r.asientoId);
    expect(a.debe("1.1.7.07")).toBeCloseTo(150000, 2);
    expect(a.haber("1.1.1.02.01")).toBeCloseTo(150000, 2);
    expect(a.totalDebe).toBeCloseTo(a.totalHaber, 2);

    const anticipo = await db.prisma.anticipoProveedor.findUniqueOrThrow({
      where: { id: r.anticipoId },
    });
    expect(anticipo.estado).toBe("VIGENTE");
    expect(Number(anticipo.montoArs)).toBeCloseTo(150000, 2);
    expect(Number(anticipo.saldoAplicadoArs)).toBeCloseTo(0, 2);
    expect(anticipo.cuentaContableId).toBe(s.cuentaAnticipoBienesId);
    expect(anticipo.movimientoTesoreriaId).toBeTruthy();
    expect(anticipo.asientoId).toBe(r.asientoId);
    expect(anticipo.numero).toMatch(/^AP-\d{4}-\d{4}$/);
  });

  it("anticipo de SERVICIO debita 1.1.5.01 y acredita el banco", async () => {
    const s = await seed();

    const r = await registrarAnticipoProveedorAction({
      proveedorId: s.proveedorId,
      cuentaContableId: s.cuentaAnticipoServiciosId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: "2026-06-10",
      monto: "80000.00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const a = await lineasDelAsiento(r.asientoId);
    expect(a.debe("1.1.5.01")).toBeCloseTo(80000, 2);
    expect(a.haber("1.1.1.02.01")).toBeCloseTo(80000, 2);
    expect(a.totalDebe).toBeCloseTo(a.totalHaber, 2);
  });

  it("rechaza registrar un anticipo contra una cuenta fuera del subárbol de anticipo", async () => {
    const s = await seed();

    const r = await registrarAnticipoProveedorAction({
      proveedorId: s.proveedorId,
      cuentaContableId: s.cuentaGastoId, // 7.9.99 — no es cuenta de anticipo
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: "2026-06-10",
      monto: "1000.00",
    });
    expect(r.ok).toBe(false);
    // No debe haber creado ni anticipo ni movimiento.
    expect(await db.prisma.anticipoProveedor.count()).toBe(0);
    expect(await db.prisma.movimientoTesoreria.count()).toBe(0);
  });

  it("listarCuentasAnticipoProveedor devuelve sólo cuentas bajo 1.1.7.07/1.1.5.01", async () => {
    await seed();
    const cuentas = await listarCuentasAnticipoProveedor();
    const codigos = cuentas.map((c) => c.codigo).sort();
    expect(codigos).toContain("1.1.7.07");
    expect(codigos).toContain("1.1.5.01");
    expect(codigos).not.toContain("7.9.99");
    expect(codigos).not.toContain("1.1.1.02.01");
  });
});
