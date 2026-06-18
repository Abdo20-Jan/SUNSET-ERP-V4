import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Listados que alimentan la UI de "Anticipos a proveedor" (decisión #4):
//   - listarProveedoresParaAnticipo: proveedores activos (form de registro).
//   - listarAnticiposProveedor: tabla, con saldoPendiente = monto − aplicado.
//   - listarFacturasAplicablesProveedor: Compras EMITIDA|RECIBIDA + Gastos
//     CONTABILIZADO del proveedor (select del sheet de aplicación).
//   - getAnticipoDetalle: anticipo + aplicaciones (sheet de detalle).

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
  aplicarAnticipoProveedorAction,
  getAnticipoDetalle,
  listarAnticiposProveedor,
  listarFacturasAplicablesProveedor,
  listarProveedoresParaAnticipo,
  registrarAnticipoProveedorAction,
} from "@/lib/actions/anticipos-proveedor";

interface Seed {
  proveedorId: string;
  otroProveedorId: string;
  proveedorInactivoId: string;
  cuentaBancariaId: string;
  cuentaAnticipoBienesId: number;
  compraEmitidaId: string;
  compraBorradorId: string;
  gastoContabilizadoId: string;
}

describe("Anticipo a proveedor — listados (UI)", () => {
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
      "Compra",
      "Gasto",
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
    ) =>
      db.prisma.cuentaContable.create({
        data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4 },
      });

    const cuentaBanco = await mkCuenta("1.1.1.02.01", "BANCO SANTANDER ARS", "ACTIVO");
    const anticipoBienes = await mkCuenta(
      "1.1.7.07",
      "ANTICIPOS A PROVEEDORES DE BIENES DE CAMBIO",
      "ACTIVO",
    );
    // Cuenta de pasivo del proveedor (cta. a pagar) — la cancela la aplicación.
    const cuentaPasivo = await mkCuenta("2.1.1.01.01", "PROVEEDORES LOCALES", "PASIVO");

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
      data: {
        nombre: "Proveedor Local SA",
        tipoProveedor: "MERCADERIA_LOCAL",
        cuentaContableId: cuentaPasivo.id,
      },
    });
    const otroProveedor = await db.prisma.proveedor.create({
      data: { nombre: "Otro Proveedor SA", tipoProveedor: "MERCADERIA_LOCAL" },
    });
    const proveedorInactivo = await db.prisma.proveedor.create({
      data: { nombre: "Inactivo SA", tipoProveedor: "MERCADERIA_LOCAL", estado: "inactivo" },
    });

    const compraEmitida = await db.prisma.compra.create({
      data: {
        numero: "FC-2026-0001",
        proveedorId: proveedor.id,
        fecha: new Date("2026-06-05T00:00:00.000Z"),
        moneda: "ARS",
        subtotal: "100000.00",
        iva: "21000.00",
        total: "121000.00",
        estado: "EMITIDA",
      },
    });
    const compraBorrador = await db.prisma.compra.create({
      data: {
        numero: "FC-2026-0002",
        proveedorId: proveedor.id,
        fecha: new Date("2026-06-06T00:00:00.000Z"),
        moneda: "ARS",
        subtotal: "50000.00",
        iva: "10500.00",
        total: "60500.00",
        estado: "BORRADOR",
      },
    });
    // Compra de OTRO proveedor — no debe aparecer en el listado del proveedor.
    await db.prisma.compra.create({
      data: {
        numero: "FC-2026-0003",
        proveedorId: otroProveedor.id,
        fecha: new Date("2026-06-07T00:00:00.000Z"),
        moneda: "ARS",
        subtotal: "10000.00",
        iva: "2100.00",
        total: "12100.00",
        estado: "EMITIDA",
      },
    });
    const gastoContabilizado = await db.prisma.gasto.create({
      data: {
        numero: "GA-2026-0001",
        proveedorId: proveedor.id,
        fecha: new Date("2026-06-08T00:00:00.000Z"),
        moneda: "ARS",
        subtotal: "30000.00",
        iva: "6300.00",
        total: "36300.00",
        estado: "CONTABILIZADO",
      },
    });
    // Gasto en BORRADOR — no aplicable.
    await db.prisma.gasto.create({
      data: {
        numero: "GA-2026-0002",
        proveedorId: proveedor.id,
        fecha: new Date("2026-06-09T00:00:00.000Z"),
        moneda: "ARS",
        subtotal: "5000.00",
        iva: "1050.00",
        total: "6050.00",
        estado: "BORRADOR",
      },
    });

    return {
      proveedorId: proveedor.id,
      otroProveedorId: otroProveedor.id,
      proveedorInactivoId: proveedorInactivo.id,
      cuentaBancariaId: cuentaBancaria.id,
      cuentaAnticipoBienesId: anticipoBienes.id,
      compraEmitidaId: compraEmitida.id,
      compraBorradorId: compraBorrador.id,
      gastoContabilizadoId: gastoContabilizado.id,
    };
  }

  it("listarProveedoresParaAnticipo devuelve sólo activos, ordenados, con cuentaContableId", async () => {
    const s = await seed();
    const proveedores = await listarProveedoresParaAnticipo();

    const nombres = proveedores.map((p) => p.nombre);
    expect(nombres).toEqual(["Otro Proveedor SA", "Proveedor Local SA"]);
    expect(nombres).not.toContain("Inactivo SA");

    const local = proveedores.find((p) => p.id === s.proveedorId);
    expect(local?.cuentaContableId).not.toBeNull();
  });

  it("listarAnticiposProveedor calcula saldoPendiente y serializa decimales", async () => {
    const s = await seed();

    const r = await registrarAnticipoProveedorAction({
      proveedorId: s.proveedorId,
      cuentaContableId: s.cuentaAnticipoBienesId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: "2026-06-10",
      monto: "150000.00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const rows = await listarAnticiposProveedor();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.numero).toBe(r.numero);
    expect(row.montoArs).toBe("150000.00");
    expect(row.saldoAplicadoArs).toBe("0.00");
    // saldoPendiente = 150000 − 0 = 150000, serializado a string.
    expect(row.saldoPendienteArs).toBe("150000.00");
    expect(typeof row.saldoPendienteArs).toBe("string");
    expect(row.estado).toBe("VIGENTE");
    expect(row.proveedor.nombre).toBe("Proveedor Local SA");
    expect(row.cuentaContable.codigo).toBe("1.1.7.07");
    expect(row.cuentaBancaria.banco).toBe("Santander");
    expect(row.asiento?.estado).toBe("CONTABILIZADO");
  });

  it("listarAnticiposProveedor refleja el saldo tras una aplicación parcial", async () => {
    const s = await seed();

    const r = await registrarAnticipoProveedorAction({
      proveedorId: s.proveedorId,
      cuentaContableId: s.cuentaAnticipoBienesId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: "2026-06-10",
      monto: "100000.00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const apl = await aplicarAnticipoProveedorAction({
      anticipoId: r.anticipoId,
      compraId: s.compraEmitidaId,
      montoArs: "40000.00",
    });
    expect(apl.ok).toBe(true);

    const rows = await listarAnticiposProveedor();
    const row = rows[0];
    expect(row.saldoAplicadoArs).toBe("40000.00");
    expect(row.saldoPendienteArs).toBe("60000.00");
    expect(row.estado).toBe("VIGENTE");
  });

  it("listarFacturasAplicablesProveedor sólo trae Compras EMITIDA|RECIBIDA + Gastos CONTABILIZADO del proveedor", async () => {
    const s = await seed();
    const facturas = await listarFacturasAplicablesProveedor(s.proveedorId);

    const numeros = facturas.map((f) => f.numero).sort();
    // EMITIDA + CONTABILIZADO; NO el borrador de compra, NO el gasto borrador,
    // NO la compra de otro proveedor.
    expect(numeros).toEqual(["FC-2026-0001", "GA-2026-0001"]);

    const compra = facturas.find((f) => f.numero === "FC-2026-0001");
    expect(compra?.tipo).toBe("compra");
    expect(compra?.total).toBe("121000.00");
    const gasto = facturas.find((f) => f.numero === "GA-2026-0001");
    expect(gasto?.tipo).toBe("gasto");

    // Orden por fecha desc: el gasto (06-08) antes que la compra (06-05).
    expect(facturas.map((f) => f.numero)).toEqual(["GA-2026-0001", "FC-2026-0001"]);
  });

  it("getAnticipoDetalle devuelve el anticipo + sus aplicaciones", async () => {
    const s = await seed();

    const r = await registrarAnticipoProveedorAction({
      proveedorId: s.proveedorId,
      cuentaContableId: s.cuentaAnticipoBienesId,
      cuentaBancariaId: s.cuentaBancariaId,
      fecha: "2026-06-10",
      monto: "100000.00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await aplicarAnticipoProveedorAction({
      anticipoId: r.anticipoId,
      compraId: s.compraEmitidaId,
      montoArs: "30000.00",
    });

    const detalle = await getAnticipoDetalle(r.anticipoId);
    expect(detalle).not.toBeNull();
    if (!detalle) return;
    expect(detalle.numero).toBe(r.numero);
    expect(detalle.saldoPendienteArs).toBe("70000.00");
    expect(detalle.aplicaciones).toHaveLength(1);
    expect(detalle.aplicaciones[0].montoArs).toBe("30000.00");
    expect(detalle.aplicaciones[0].factura).toEqual({ tipo: "compra", numero: "FC-2026-0001" });
    expect(detalle.aplicaciones[0].asientoNumero).not.toBeNull();
  });

  it("getAnticipoDetalle devuelve null para un id inexistente", async () => {
    await seed();
    const detalle = await getAnticipoDetalle("00000000-0000-0000-0000-000000000000");
    expect(detalle).toBeNull();
  });
});
