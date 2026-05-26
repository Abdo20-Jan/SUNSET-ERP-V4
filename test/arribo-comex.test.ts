import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Ponte PR C — asiento de arribo comex (Modelo Y). Para embarques CON
// contenedores (flag on), confirmar zona primaria NO mueve stock: lanza un
// asiento que DEBE 1.1.5.04 (MERCADERÍAS EN ZONA PRIMARIA) por el total
// rateable / HABER proveedores. El primer ingreso de stock recién ocurre en la
// desconsolidación (DF). Para embarques SIN contenedores, el flujo legacy
// (1.1.5.02 + ingreso de stock ZPA) queda intacto.

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
import { crearAsientoEmbarqueCosto } from "@/lib/services/asiento-automatico";

const FECHA_ISO = "2026-05-21T12:00:00.000Z";

describe("arribo comex — Modelo Y (Ponte PR C)", () => {
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
    process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED = "true";
    await db.reset([
      "MovimientoStock",
      "StockPorDeposito",
      "LineaAsiento",
      "Asiento",
      "ItemContenedor",
      "Contenedor",
      "ItemEmbarque",
      "Embarque",
      "Deposito",
      "Producto",
      "Proveedor",
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

  async function lineasPorCuenta(asientoId: string) {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId },
      include: { cuenta: { select: { codigo: true } } },
    });
    const debe = new Map<string, number>();
    const haber = new Map<string, number>();
    let totalDebe = 0;
    let totalHaber = 0;
    for (const l of lineas) {
      if (l.debe.gt(0))
        debe.set(l.cuenta.codigo, (debe.get(l.cuenta.codigo) ?? 0) + Number(l.debe));
      if (l.haber.gt(0))
        haber.set(l.cuenta.codigo, (haber.get(l.cuenta.codigo) ?? 0) + Number(l.haber));
      totalDebe += Number(l.debe);
      totalHaber += Number(l.haber);
    }
    return { debe, haber, totalDebe, totalHaber };
  }

  // FOB 1000 USD @ TC 1000 → base rateable 1.000.000 ARS. costoFCUnitario ya
  // cerrado (PR B): 10,0000 USD/u para ambos SKU. Σ FC×cant×TC = 1.000.000.
  async function seedComex() {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prodA = await db.prisma.producto.create({ data: { codigo: "A-1", nombre: "Prod A" } });
    const prodB = await db.prisma.producto.create({ data: { codigo: "B-1", nombre: "Prod B" } });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-COMEX",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        fobTotal: "1000.00",
      },
    });
    const ieA = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prodA.id,
        cantidad: 60,
        precioUnitarioFob: "10.00",
      },
    });
    const ieB = await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prodB.id,
        cantidad: 40,
        precioUnitarioFob: "10.00",
      },
    });
    const cont = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU-1", estado: "EN_TRANSITO" },
    });
    await db.prisma.itemContenedor.createMany({
      data: [
        {
          contenedorId: cont.id,
          itemEmbarqueId: ieA.id,
          productoId: prodA.id,
          cantidadDeclarada: 60,
          costoFCUnitario: "10.0000",
        },
        {
          contenedorId: cont.id,
          itemEmbarqueId: ieB.id,
          productoId: prodB.id,
          cantidadDeclarada: 40,
          costoFCUnitario: "10.0000",
        },
      ],
    });
    return { embarqueId: embarque.id, prodAId: prodA.id, prodBId: prodB.id };
  }

  it("embarque con contenedores → asiento DEBE 1.1.5.04, sin movimiento de stock", async () => {
    const s = await seedComex();
    const res = await confirmarZonaPrimariaAction(s.embarqueId, FECHA_ISO);
    expect(res.ok).toBe(true);

    const embarque = await db.prisma.embarque.findUniqueOrThrow({ where: { id: s.embarqueId } });
    expect(embarque.estado).toBe("EN_ZONA_PRIMARIA");
    expect(embarque.asientoZonaPrimariaId).not.toBeNull();
    expect(embarque.fechaZonaPrimaria?.toISOString()).toBe(FECHA_ISO);

    const { debe, haber, totalDebe, totalHaber } = await lineasPorCuenta(
      embarque.asientoZonaPrimariaId!,
    );
    // DEBE en 1.1.5.04 (ZONA PRIMARIA), NUNCA en 1.1.5.02 (EN TRÁNSITO).
    expect(debe.get("1.1.5.04")).toBeCloseTo(1_000_000, 2);
    expect(debe.has("1.1.5.02")).toBe(false);
    // Asiento balanceado; el HABER va a proveedor exterior.
    expect(totalDebe).toBeCloseTo(totalHaber, 2);
    expect(totalDebe).toBeCloseTo(1_000_000, 2);
    expect([...haber.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1_000_000, 2);

    // Reconciliación con costoFCUnitario: Σ FC × cant × TC == débito 1.1.5.04.
    const items = await db.prisma.itemContenedor.findMany({
      where: { contenedor: { embarqueId: s.embarqueId } },
    });
    const reconc = items.reduce(
      (acc, it) => acc + Number(it.costoFCUnitario) * it.cantidadDeclarada * 1000,
      0,
    );
    expect(reconc).toBeCloseTo(debe.get("1.1.5.04") ?? 0, 2);

    // Modelo Y: el arribo NO mueve stock (eso ocurre en la desconsolidación).
    const movs = await db.prisma.movimientoStock.count();
    expect(movs).toBe(0);
    const spd = await db.prisma.stockPorDeposito.count();
    expect(spd).toBe(0);
  });

  it("factura ZP ya EMITIDA → el arribo reclasifica el gasto 5.x a 1.1.5.04 (neteándolo)", async () => {
    const provExt = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const ctaPasivo = await db.prisma.cuentaContable.create({
      data: {
        codigo: "2.1.1.99",
        nombre: "Proveedor Local",
        tipo: "ANALITICA",
        categoria: "PASIVO",
        nivel: 4,
      },
    });
    const ctaGasto = await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.4.1.11",
        nombre: "Gastos Portuarios",
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
      },
    });
    const provLocal = await db.prisma.proveedor.create({
      data: { nombre: "TRP SA", cuentaContableId: ctaPasivo.id },
    });
    const prod = await db.prisma.producto.create({ data: { codigo: "Z-1", nombre: "Prod Z" } });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-EMIT",
        proveedorId: provExt.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        fobTotal: "1000.00",
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
    const cont = await db.prisma.contenedor.create({
      data: { embarqueId: embarque.id, numeroContenedor: "MSCU-Z", estado: "EN_TRANSITO" },
    });
    await db.prisma.itemContenedor.create({
      data: {
        contenedorId: cont.id,
        itemEmbarqueId: ie.id,
        productoId: prod.id,
        cantidadDeclarada: 100,
      },
    });
    // Factura ZP con un gasto de 500 USD @ TC 1000 = 500.000 ARS.
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
    // Emitir la factura standalone (DEBE 5.4.1.11 / HABER proveedor local).
    await crearAsientoEmbarqueCosto(costo.id, db.prisma);
    const costoEmitido = await db.prisma.embarqueCosto.findUniqueOrThrow({
      where: { id: costo.id },
    });
    expect(costoEmitido.estado).toBe("EMITIDA");

    const res = await confirmarZonaPrimariaAction(embarque.id, FECHA_ISO);
    expect(res.ok).toBe(true);

    const fresh = await db.prisma.embarque.findUniqueOrThrow({ where: { id: embarque.id } });
    const { debe, haber, totalDebe, totalHaber } = await lineasPorCuenta(
      fresh.asientoZonaPrimariaId!,
    );
    // 1.1.5.04 = FOB (1.000.000) + subtotal factura (500.000).
    expect(debe.get("1.1.5.04")).toBeCloseTo(1_500_000, 2);
    // El arribo ACREDITA 5.4.1.11 (reclasificación), neteando el gasto.
    expect(haber.get("5.4.1.11")).toBeCloseTo(500_000, 2);
    expect(totalDebe).toBeCloseTo(totalHaber, 2);

    // El gasto 5.4.1.11 neteado a CERO entre emisión (DEBE) y arribo (HABER).
    const lineasGasto = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo: "5.4.1.11" } },
    });
    const netoGasto = lineasGasto.reduce((acc, l) => acc + Number(l.debe) - Number(l.haber), 0);
    expect(netoGasto).toBeCloseTo(0, 2);

    // Modelo Y: sigue sin mover stock en el arribo.
    expect(await db.prisma.movimientoStock.count()).toBe(0);
  });

  it("embarque sin contenedores → flujo legacy intacto (1.1.5.02 + ingreso de stock)", async () => {
    const prov = await db.prisma.proveedor.create({ data: { nombre: "Exterior SA" } });
    const prod = await db.prisma.producto.create({
      data: { codigo: "L-1", nombre: "Prod Legacy" },
    });
    const depZpa = await db.prisma.deposito.create({
      data: { nombre: "ZPA", tipo: "ZONA_PRIMARIA" },
    });
    const embarque = await db.prisma.embarque.create({
      data: {
        codigo: "EMB-LEGACY",
        proveedorId: prov.id,
        moneda: "USD",
        tipoCambio: "1000.000000",
        fobTotal: "1000.00",
        depositoZonaPrimariaId: depZpa.id,
      },
    });
    await db.prisma.itemEmbarque.create({
      data: {
        embarqueId: embarque.id,
        productoId: prod.id,
        cantidad: 100,
        precioUnitarioFob: "10.00",
      },
    });

    const res = await confirmarZonaPrimariaAction(embarque.id, FECHA_ISO);
    expect(res.ok).toBe(true);

    const fresh = await db.prisma.embarque.findUniqueOrThrow({ where: { id: embarque.id } });
    const { debe } = await lineasPorCuenta(fresh.asientoZonaPrimariaId!);
    // Legacy: DEBE 1.1.5.02 (EN TRÁNSITO), NO 1.1.5.04.
    expect(debe.get("1.1.5.02")).toBeCloseTo(1_000_000, 2);
    expect(debe.has("1.1.5.04")).toBe(false);
    // Legacy SÍ ingresa stock físico al depósito ZPA.
    const movs = await db.prisma.movimientoStock.count();
    expect(movs).toBeGreaterThan(0);
  });
});
