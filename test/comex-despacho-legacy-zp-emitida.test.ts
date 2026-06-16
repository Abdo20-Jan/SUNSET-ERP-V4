import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Onda A #5 — despacho legacy (crearAsientoDespacho) y las facturas ZP EMITIDA.
//
// El despacho legacy transfiere el costo en tránsito 1.1.5.02 → 1.1.5.01 por la
// porción despachada. Ese costo = FOB + flete/seguro origen + Σ subtotales de
// facturas momento=ZONA_PRIMARIA. PERO el filtro de esas facturas usaba
// `estado !== "ANULADA"`, incluyendo las **EMITIDA** — que ya tienen su asiento
// standalone (DEBE gasto 5.x / HABER proveedor) y NUNCA se capitalizaron en
// 1.1.5.02. Resultado: el despacho acreditaba 1.1.5.02 de más (→ saldo ACREEDOR)
// y duplicaba el costo (gasto 5.x + capitalizado en 1.1.5.01).
//
// El fix alinea el filtro con `crearAsientoZonaPrimaria` y con el de facturas de
// despacho: sólo BORRADOR y LEGACY_BUNDLED. Las EMITIDA quedan fuera.

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

import { confirmarZonaPrimariaAction } from "@/lib/actions/embarques";
import { crearAsientoDespacho, crearAsientoEmbarqueCosto } from "@/lib/services/asiento-automatico";

const FECHA_ISO = "2026-05-21T12:00:00.000Z";
const FECHA = new Date(FECHA_ISO);

describe("despacho legacy — facturas ZP EMITIDA no se re-capitalizan (Onda A #5)", () => {
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
    // Sin contenedores → flujo legacy (no Modelo Y), independientemente del flag.
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    await db.reset([
      "Transferencia",
      "ItemDespacho",
      "Despacho",
      "MovimientoStock",
      "StockPorDeposito",
      "LineaAsiento",
      "Asiento",
      "EmbarqueCostoLinea",
      "EmbarqueCosto",
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Deposito",
      "Producto",
      "Proveedor",
      "PeriodoContable",
      "CuentaContable",
      "IdempotencyKey",
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

  /** Σ debe de una cuenta por código, sólo asientos vivos (excluye ANULADO). */
  async function debeCuenta(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: { not: "ANULADO" } } },
      select: { debe: true },
    });
    return lineas.reduce((acc, l) => acc + Number(l.debe), 0);
  }

  /** Saldo neto (Σ debe − Σ haber) de una cuenta, sólo asientos vivos. */
  async function netoCuenta(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: { not: "ANULADO" } } },
      select: { debe: true, haber: true },
    });
    return lineas.reduce((acc, l) => acc + Number(l.debe) - Number(l.haber), 0);
  }

  /**
   * Embarque legacy (sin contenedores): FOB 1000 USD @ TC 1000 = 1.000.000 ARS,
   * 1 ítem de 100 u. Una factura ZP de subtotal 500 USD (500.000 ARS). El estado
   * de esa factura (EMITIDA vs BORRADOR) lo decide el caller.
   */
  async function seedLegacy() {
    const provExt = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const ctaPasivo = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.97",
        nombre: "Proveedor Local ZP",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 4,
      },
    });
    const ctaGasto = await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.4.1.12",
        nombre: "Gastos Portuarios",
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
      },
    });
    const provLocal = await db.prisma.proveedor.create({
      data: { nombre: "TRP SA", cuentaContableId: ctaPasivo.id },
    });
    const prod = await db.prisma.producto.create({
      data: { codigo: "L-1", nombre: "Prod Legacy" },
    });
    const depZpa = await db.prisma.deposito.create({
      data: { nombre: "ZPA", tipo: "ZONA_PRIMARIA" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-LEG",
        proveedorId: provExt.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        fobTotal: "1000.00",
        depositoZonaPrimariaId: depZpa.id,
      },
    });
    const ie = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prod.id,
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });
    const costo = await db.prisma.embarqueCosto.create({
      data: {
        embarqueId: embarque.id,
        proveedorId: provLocal.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        momento: "ZONA_PRIMARIA",
        estado: "BORRADOR",
        fechaFactura: new Date("2026-05-10T12:00:00.000Z"),
        lineas: {
          create: [
            { tipo: "GASTOS_PORTUARIOS", cuentaContableGastoId: ctaGasto.id, subtotal: "500.00" },
          ],
        },
      },
    });
    return { embarqueId: embarque.id, itemEmbarqueId: ie.id, costoId: costo.id };
  }

  /** Crea un despacho legacy (BORRADOR, líneas sin contenedor) por la cantidad total. */
  async function crearDespachoTotal(embarqueId: string, itemEmbarqueId: number, cantidad: number) {
    const despacho = await db.prisma.despacho.create({
      data: {
        codigo: "DSP-LEG-1",
        embarqueId,
        fecha: FECHA,
        estado: "BORRADOR",
        tipoCambio: "1000.000000",
        items: { create: [{ itemEmbarqueId, cantidad }] },
      },
    });
    return despacho.id;
  }

  it("factura ZP EMITIDA queda FUERA del traslado: 1.1.5.01 = FOB y 1.1.5.02 neto 0", async () => {
    const s = await seedLegacy();

    // Emitir la factura ZP standalone → EMITIDA (DEBE 5.4.1.12 / HABER proveedor).
    await crearAsientoEmbarqueCosto(s.costoId, db.prisma);
    const costo = await db.prisma.embarqueCosto.findUniqueOrThrow({ where: { id: s.costoId } });
    expect(costo.estado).toBe("EMITIDA");

    // Confirmar zona primaria (legacy): DEBE 1.1.5.02 = FOB (1.000.000); la
    // EMITIDA NO entra (el confirm filtra BORRADOR/LEGACY_BUNDLED).
    const cf = await confirmarZonaPrimariaAction(s.embarqueId, FECHA_ISO);
    expect(cf.ok).toBe(true);
    expect(await netoCuenta("1.1.5.02")).toBeCloseTo(1_000_000, 2);

    // Despachar el total y contabilizar.
    const despachoId = await crearDespachoTotal(s.embarqueId, s.itemEmbarqueId, 100);
    await crearAsientoDespacho(despachoId, db.prisma);

    // El traslado capitaliza SÓLO el FOB (no la EMITIDA): 1.1.5.01 = 1.000.000.
    expect(await debeCuenta("1.1.5.01")).toBeCloseTo(1_000_000, 2);
    // 1.1.5.02 vuelve a CERO (entró FOB en el arribo, sale FOB en el despacho).
    expect(await netoCuenta("1.1.5.02")).toBeCloseTo(0, 2);
    // El gasto 5.4.1.12 de la EMITIDA NO se duplica: sigue con su único débito.
    expect(await debeCuenta("5.4.1.12")).toBeCloseTo(500_000, 2);
  });

  it("factura ZP BORRADOR sí se capitaliza en el despacho (control de alcance)", async () => {
    const s = await seedLegacy();
    // Sin emitir: la factura queda BORRADOR.

    const cf = await confirmarZonaPrimariaAction(s.embarqueId, FECHA_ISO);
    expect(cf.ok).toBe(true);

    const despachoId = await crearDespachoTotal(s.embarqueId, s.itemEmbarqueId, 100);
    await crearAsientoDespacho(despachoId, db.prisma);

    // BORRADOR sigue dentro del costo capitalizado: 1.1.5.01 = FOB + subtotal ZP.
    expect(await debeCuenta("1.1.5.01")).toBeCloseTo(1_500_000, 2);
  });
});
