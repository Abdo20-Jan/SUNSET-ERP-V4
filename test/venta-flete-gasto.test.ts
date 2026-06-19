import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Flete de la venta como factura de gasto (proveedor + IVA + CxP real).
//
// Decisión: el frete de la venta se captura como un `Gasto` vinculado
// (Gasto.ventaId). Cuando existe ese gasto:
//  - crearAsientoVenta NO lanza las líneas inline FLETE_GASTO/FLETE_POR_PAGAR
//    (evita doble contabilización),
//  - al emitir la venta se contabiliza el Gasto (DEBE flete 5.2.1.01 + DEBE IVA
//    crédito 1.1.4.08 / HABER proveedor → CxP real),
//  - al anular la venta se anula también el gasto vinculado,
//  - Venta.flete = subtotal neto del gasto (base de rentabilidad).
// Sin factura (legado): el flete suelto se contabiliza inline como antes.

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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  anularVentaAction,
  emitirVentaAction,
  guardarVentaAction,
  type VentaInput,
} from "@/lib/actions/ventas";

const FLETE_GASTO_CODIGO = "6.3.01";
const FLETE_POR_PAGAR_CODIGO = "2.1.1.06";
const IVA_CREDITO_CODIGO = "1.1.4.1.01";
const PROVEEDOR_FALLBACK_CODIGO = "2.1.1.01.000001";

describe("Venta — flete como factura de gasto", () => {
  let db: TestDb;
  let clienteId: string;
  let productoId: string;
  let proveedorId: string;
  // Secuencia determinística para números únicos (evita Math.random — Codacy).
  let seq = 0;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    seq += 1;
    await db.reset([
      "LineaAsiento",
      "Asiento",
      "LineaGasto",
      "Gasto",
      "ItemVenta",
      "ChequeRecibido",
      "Venta",
      "Producto",
      "Cliente",
      "Proveedor",
      "CuentaContable",
      "PeriodoContable",
    ]);

    await db.prisma.periodoContable.create({
      data: {
        codigo: "2026-05",
        nombre: "Mayo 2026",
        fechaInicio: new Date(Date.UTC(2026, 4, 1)),
        fechaFin: new Date(Date.UTC(2026, 4, 31)),
        estado: "ABIERTO",
      },
    });

    const cliente = await db.prisma.cliente.create({
      data: { nombre: `Cliente ${seq}`, tipo: "minorista" },
    });
    clienteId = cliente.id;

    const producto = await db.prisma.producto.create({
      data: {
        codigo: `P-${seq}`,
        nombre: `Producto ${seq}`,
        costoPromedio: "100",
        precioVenta: "1000",
      },
    });
    productoId = producto.id;

    const proveedor = await db.prisma.proveedor.create({
      data: { nombre: `Transportista ${seq}`, pais: "AR" },
    });
    proveedorId = proveedor.id;
  });

  function ventaBase(overrides: Partial<VentaInput> = {}): VentaInput {
    return {
      numero: `V-2026-${String(seq).padStart(4, "0")}`,
      clienteId,
      fecha: "2026-05-15",
      condicionPago: "CUENTA_CORRIENTE",
      moneda: "ARS",
      tipoCambio: "1",
      iibb: "0",
      otros: "0",
      flete: "0",
      items: [
        {
          productoId,
          cantidad: 2,
          precioUnitario: "1000",
          ivaPorcentaje: "21",
        },
      ],
      ...overrides,
    };
  }

  async function lineasAsiento(asientoId: string) {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true } } },
    });
    return lineas.map((l) => ({
      codigo: l.cuenta.codigo,
      debe: l.debe.toString(),
      haber: l.haber.toString(),
    }));
  }

  it("con fleteFactura: crea Gasto vinculado y al emitir contabiliza CxP real + IVA crédito; el asiento de venta NO tiene línea de flete", async () => {
    const guard = await guardarVentaAction(
      ventaBase({
        fleteFactura: {
          proveedorId,
          facturaNumero: "A-0001-00000123",
          fechaFactura: "2026-05-15",
          moneda: "ARS",
          tipoCambio: "1",
          subtotal: "5000",
          iva: "1050",
          iibb: "0",
          otros: "0",
        },
      }),
    );
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;

    // Gasto vinculado creado en BORRADOR con la línea en FLETE SOBRE VENTAS.
    const gasto = await db.prisma.gasto.findUnique({
      where: { ventaId: guard.id },
      include: { lineas: { include: { cuentaContableGasto: true } } },
    });
    expect(gasto).not.toBeNull();
    expect(gasto?.estado).toBe("BORRADOR");
    expect(gasto?.subtotal.toString()).toBe("5000");
    expect(gasto?.total.toString()).toBe("6050");
    expect(gasto?.lineas).toHaveLength(1);
    expect(gasto?.lineas[0].cuentaContableGasto.codigo).toBe(FLETE_GASTO_CODIGO);

    // Venta.flete = subtotal neto del flete (base de rentabilidad).
    const venta = await db.prisma.venta.findUniqueOrThrow({ where: { id: guard.id } });
    expect(venta.flete.toString()).toBe("5000");

    // Emitir: contabiliza venta + gasto en la misma transacción.
    const emit = await emitirVentaAction(guard.id);
    expect(emit.ok).toBe(true);

    const ventaEmit = await db.prisma.venta.findUniqueOrThrow({ where: { id: guard.id } });
    const gastoEmit = await db.prisma.gasto.findUniqueOrThrow({ where: { ventaId: guard.id } });
    expect(gastoEmit.estado).toBe("CONTABILIZADO");
    expect(gastoEmit.asientoId).not.toBeNull();

    // Asiento de VENTA: SIN línea de flete (ni gasto ni por pagar).
    const lineasVenta = await lineasAsiento(ventaEmit.asientoId!);
    expect(lineasVenta.some((l) => l.codigo === FLETE_GASTO_CODIGO)).toBe(false);
    expect(lineasVenta.some((l) => l.codigo === FLETE_POR_PAGAR_CODIGO)).toBe(false);

    // Asiento del GASTO: DEBE flete 5000 + DEBE IVA crédito 1050 / HABER proveedor 6050.
    const lineasGasto = await lineasAsiento(gastoEmit.asientoId!);
    const fleteLinea = lineasGasto.find((l) => l.codigo === FLETE_GASTO_CODIGO);
    expect(fleteLinea?.debe).toBe("5000");
    const ivaLinea = lineasGasto.find((l) => l.codigo === IVA_CREDITO_CODIGO);
    expect(ivaLinea?.debe).toBe("1050");
    const provLinea = lineasGasto.find((l) => l.codigo === PROVEEDOR_FALLBACK_CODIGO);
    expect(provLinea?.haber).toBe("6050");

    // Asiento del gasto balancea (CxP real).
    const totalDebe = lineasGasto.reduce((a, l) => a + Number(l.debe), 0);
    const totalHaber = lineasGasto.reduce((a, l) => a + Number(l.haber), 0);
    expect(totalDebe).toBeCloseTo(totalHaber, 2);
    expect(totalDebe).toBeCloseTo(6050, 2);
  });

  it("sin fleteFactura (legado): el asiento de venta mantiene las líneas de flete inline", async () => {
    const guard = await guardarVentaAction(ventaBase({ flete: "300" }));
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;

    // No hay gasto vinculado.
    const gasto = await db.prisma.gasto.findUnique({ where: { ventaId: guard.id } });
    expect(gasto).toBeNull();

    const emit = await emitirVentaAction(guard.id);
    expect(emit.ok).toBe(true);

    const venta = await db.prisma.venta.findUniqueOrThrow({ where: { id: guard.id } });
    expect(venta.flete.toString()).toBe("300");

    const lineas = await lineasAsiento(venta.asientoId!);
    const fleteGasto = lineas.find((l) => l.codigo === FLETE_GASTO_CODIGO);
    const fletePorPagar = lineas.find((l) => l.codigo === FLETE_POR_PAGAR_CODIGO);
    expect(fleteGasto?.debe).toBe("300");
    expect(fletePorPagar?.haber).toBe("300");
  });

  it("anular la venta anula también el gasto de flete vinculado", async () => {
    const guard = await guardarVentaAction(
      ventaBase({
        fleteFactura: {
          proveedorId,
          moneda: "ARS",
          tipoCambio: "1",
          subtotal: "5000",
          iva: "1050",
          iibb: "0",
          otros: "0",
        },
      }),
    );
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;

    await emitirVentaAction(guard.id);

    const gastoEmit = await db.prisma.gasto.findUniqueOrThrow({ where: { ventaId: guard.id } });
    const asientoGastoId = gastoEmit.asientoId!;

    const anular = await anularVentaAction(guard.id);
    expect(anular.ok).toBe(true);

    const venta = await db.prisma.venta.findUniqueOrThrow({ where: { id: guard.id } });
    expect(venta.estado).toBe("CANCELADA");

    const gasto = await db.prisma.gasto.findUniqueOrThrow({ where: { ventaId: guard.id } });
    expect(gasto.estado).toBe("ANULADO");

    // El asiento del gasto quedó ANULADO (reversa la CxP + IVA crédito).
    const asientoGasto = await db.prisma.asiento.findUniqueOrThrow({
      where: { id: asientoGastoId },
    });
    expect(asientoGasto.estado).toBe("ANULADO");
  });

  it("la rentabilidad usa el flete neto (subtotal), no el total con IVA", async () => {
    const guard = await guardarVentaAction(
      ventaBase({
        fleteFactura: {
          proveedorId,
          moneda: "ARS",
          tipoCambio: "1",
          subtotal: "4321",
          iva: "907.41",
          iibb: "0",
          otros: "0",
        },
      }),
    );
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;

    const venta = await db.prisma.venta.findUniqueOrThrow({ where: { id: guard.id } });
    // Venta.flete = subtotal NETO (4321), no el total con IVA (5228.41).
    expect(venta.flete.toString()).toBe("4321");
  });
});
