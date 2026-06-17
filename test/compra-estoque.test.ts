import Decimal from "decimal.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// E18 — la Compra capitaliza ESTOQUE FÍSICO por categoría de ítem. Cubre:
// agrupamiento del asiento por categoría (Σdebe==Σhaber), ingreso de stock al
// emitir SÓLO para Bien de Cambio nacional (1.1.7.01) — no importación
// (1.1.7.02) ni gasto —, costo ARS histórico en USD, reversión en la anulación,
// guards (depósito faltante / no-NACIONAL / categoría no-imputable / pago
// aplicado) y no-regresión de la compra sólo-gasto.

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

import { anularCompraAction, emitirCompraAction, guardarCompraAction } from "@/lib/actions/compras";
import { crearAsientoCompra } from "@/lib/services/asiento-automatico";

const FECHA = new Date("2025-06-15T12:00:00.000Z");

interface Seed {
  proveedorId: string;
  depositoNacionalId: string;
  depositoZpId: string;
  productoAId: string;
  productoBId: string;
  catEstoqueId: number; // 1.1.7.01 — capitaliza
  catImportId: number; // 1.1.7.02 — NO capitaliza (Comex)
  catGastoId: number; // 5.3.1.50 — NO capitaliza
  catSinteticaId: number; // 1.1.7 — no imputable
}

async function seed(prisma: PrismaClient): Promise<Seed> {
  await prisma.periodoContable.create({
    data: {
      codigo: "2025-T",
      nombre: "Test 2025",
      fechaInicio: new Date("2025-01-01T00:00:00.000Z"),
      fechaFin: new Date("2025-12-31T23:59:59.000Z"),
      estado: "ABIERTO",
    },
  });

  const cuentaProveedor = await prisma.cuentaContable.create({
    data: {
      codigo: "2.1.1.10",
      nombre: "PROVEEDOR TEST",
      tipo: "ANALITICA",
      categoria: "PASIVO",
      nivel: 4,
    },
  });
  const catEstoque = await prisma.cuentaContable.create({
    data: {
      codigo: "1.1.7.01",
      nombre: "ESTOQUE NACIONALIZADO",
      tipo: "ANALITICA",
      categoria: "ACTIVO",
      nivel: 4,
    },
  });
  const catImport = await prisma.cuentaContable.create({
    data: {
      codigo: "1.1.7.02",
      nombre: "ESTOQUE A DESPACHAR",
      tipo: "ANALITICA",
      categoria: "ACTIVO",
      nivel: 4,
    },
  });
  const catGasto = await prisma.cuentaContable.create({
    data: {
      codigo: "5.3.1.50",
      nombre: "GASTO DE CONSUMO",
      tipo: "ANALITICA",
      categoria: "EGRESO",
      nivel: 4,
    },
  });
  const catSintetica = await prisma.cuentaContable.create({
    data: { codigo: "1.1.7", nombre: "ESTOQUE", tipo: "SINTETICA", categoria: "ACTIVO", nivel: 3 },
  });

  const proveedor = await prisma.proveedor.create({
    data: {
      nombre: "Proveedor Local Test",
      tipoProveedor: "MERCADERIA_LOCAL",
      monedaOperacion: "ARS",
      pais: "AR",
      cuentaContableId: cuentaProveedor.id,
    },
  });

  const depNac = await prisma.deposito.create({
    data: { nombre: "Central Nacional", tipo: "NACIONAL", activo: true },
  });
  const depZp = await prisma.deposito.create({
    data: { nombre: "Zona Primaria", tipo: "ZONA_PRIMARIA", activo: true },
  });

  const prodA = await prisma.producto.create({
    data: { codigo: "P-A", nombre: "Neumático A", stockActual: 0, costoPromedio: 0 },
  });
  const prodB = await prisma.producto.create({
    data: { codigo: "P-B", nombre: "Neumático B", stockActual: 0, costoPromedio: 0 },
  });

  return {
    proveedorId: proveedor.id,
    depositoNacionalId: depNac.id,
    depositoZpId: depZp.id,
    productoAId: prodA.id,
    productoBId: prodB.id,
    catEstoqueId: catEstoque.id,
    catImportId: catImport.id,
    catGastoId: catGasto.id,
    catSinteticaId: catSintetica.id,
  };
}

type ItemSeed = {
  productoId: string;
  cantidad: number;
  precioUnitario: string;
  ivaPct?: string;
  categoriaCuentaId: number | null;
};

let compraSeq = 0;

async function crearCompra(
  prisma: PrismaClient,
  s: Seed,
  opts: {
    moneda?: "ARS" | "USD";
    tipoCambio?: string;
    depositoId?: string | null;
    items: ItemSeed[];
  },
): Promise<string> {
  const tc = new Decimal(opts.tipoCambio ?? "1");
  let subtotal = new Decimal(0);
  let iva = new Decimal(0);
  const itemsData = opts.items.map((it) => {
    const sub = new Decimal(it.precioUnitario).times(it.cantidad);
    const ivaLinea = sub.times(new Decimal(it.ivaPct ?? "0").dividedBy(100));
    subtotal = subtotal.plus(sub);
    iva = iva.plus(ivaLinea);
    return {
      productoId: it.productoId,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario,
      subtotal: sub.toDecimalPlaces(2).toString(),
      iva: ivaLinea.toDecimalPlaces(2).toString(),
      total: sub.plus(ivaLinea).toDecimalPlaces(2).toString(),
      categoriaCuentaId: it.categoriaCuentaId,
    };
  });
  const total = subtotal.plus(iva);
  compraSeq += 1;
  const compra = await prisma.compra.create({
    data: {
      numero: `C-T-${compraSeq}`,
      proveedorId: s.proveedorId,
      fecha: FECHA,
      moneda: opts.moneda ?? "ARS",
      tipoCambio: tc.toString(),
      subtotal: subtotal.toDecimalPlaces(2).toString(),
      iva: iva.toDecimalPlaces(2).toString(),
      iibb: "0",
      otros: "0",
      total: total.toDecimalPlaces(2).toString(),
      estado: "BORRADOR",
      depositoId: opts.depositoId ?? null,
      items: { create: itemsData },
    },
  });
  return compra.id;
}

describe("E18 — compra capitaliza estoque físico por categoría", () => {
  let db: TestDb;
  let s: Seed;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    compraSeq = 0;
    await db.reset([
      "AplicacionPagoCompra",
      "MovimientoStock",
      "ItemCompra",
      "Compra",
      "LineaAsiento",
      "Asiento",
      "StockPorDeposito",
      "Producto",
      "Proveedor",
      "Deposito",
      "CuentaContable",
      "PeriodoContable",
    ]);
    s = await seed(db.prisma);
  });

  it("agrupa el asiento por categoría (1 línea DEBE por categoría) y cuadra Σdebe==Σhaber", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 10,
          precioUnitario: "100",
          ivaPct: "21",
          categoriaCuentaId: s.catEstoqueId,
        },
        {
          productoId: s.productoBId,
          cantidad: 5,
          precioUnitario: "200",
          ivaPct: "21",
          categoriaCuentaId: s.catGastoId,
        },
      ],
      depositoId: s.depositoNacionalId,
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(true);

    const asiento = await db.prisma.asiento.findFirstOrThrow({
      where: { lineas: { some: { cuentaId: s.catEstoqueId } } },
      include: { lineas: true },
    });
    // 2 categorías + IVA + proveedor = 4 líneas
    expect(asiento.lineas).toHaveLength(4);
    const debeEstoque = asiento.lineas.find((l) => l.cuentaId === s.catEstoqueId);
    const debeGasto = asiento.lineas.find((l) => l.cuentaId === s.catGastoId);
    expect(new Decimal(debeEstoque!.debe).toNumber()).toBe(1000); // 10×100
    expect(new Decimal(debeGasto!.debe).toNumber()).toBe(1000); // 5×200
    // Σdebe == Σhaber
    const totalDebe = asiento.lineas.reduce((a, l) => a.plus(new Decimal(l.debe)), new Decimal(0));
    const totalHaber = asiento.lineas.reduce(
      (a, l) => a.plus(new Decimal(l.haber)),
      new Decimal(0),
    );
    expect(totalDebe.equals(totalHaber)).toBe(true);
    expect(totalDebe.toNumber()).toBe(2420); // 2000 + 420 IVA
  });

  it("ingresa estoque físico al emitir SÓLO para Bien de Cambio nacional (1.1.7.01)", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 10,
          precioUnitario: "150",
          categoriaCuentaId: s.catEstoqueId,
        },
      ],
      depositoId: s.depositoNacionalId,
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(true);

    const movs = await db.prisma.movimientoStock.findMany({ where: { productoId: s.productoAId } });
    expect(movs).toHaveLength(1);
    expect(movs[0].tipo).toBe("INGRESO");
    expect(movs[0].cantidad).toBe(10);
    expect(movs[0].depositoId).toBe(s.depositoNacionalId);
    expect(new Decimal(movs[0].costoUnitario).toNumber()).toBe(150);
    expect(movs[0].itemCompraId).not.toBeNull();

    const prod = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoAId } });
    expect(prod.stockActual).toBe(10);
    expect(new Decimal(prod.costoPromedio).toNumber()).toBe(150);

    const spd = await db.prisma.stockPorDeposito.findUniqueOrThrow({
      where: {
        productoId_depositoId: { productoId: s.productoAId, depositoId: s.depositoNacionalId },
      },
    });
    expect(spd.cantidadFisica).toBe(10);
  });

  it("NO genera estoque para importación (1.1.7.02) — anti doble conteo con Comex", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 8,
          precioUnitario: "100",
          categoriaCuentaId: s.catImportId,
        },
      ],
      // sin depósito: ningún ítem capitaliza
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(true);

    const movs = await db.prisma.movimientoStock.findMany({ where: { productoId: s.productoAId } });
    expect(movs).toHaveLength(0);
    const prod = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoAId } });
    expect(prod.stockActual).toBe(0);
  });

  it("NO genera estoque para categoría de gasto (EGRESO)", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 3,
          precioUnitario: "50",
          categoriaCuentaId: s.catGastoId,
        },
      ],
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(true);
    const movs = await db.prisma.movimientoStock.findMany({ where: { productoId: s.productoAId } });
    expect(movs).toHaveLength(0);
  });

  it("compra USD: costoUnitario del estoque es ARS histórico (precio×TC) y el pasivo es USD-nativo", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      moneda: "USD",
      tipoCambio: "1000",
      depositoId: s.depositoNacionalId,
      items: [
        {
          productoId: s.productoAId,
          cantidad: 2,
          precioUnitario: "100",
          categoriaCuentaId: s.catEstoqueId,
        },
      ],
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(true);

    const mov = await db.prisma.movimientoStock.findFirstOrThrow({
      where: { productoId: s.productoAId },
    });
    expect(new Decimal(mov.costoUnitario).toNumber()).toBe(100_000); // 100 × 1000

    // El HABER del proveedor lleva el principal USD invariante.
    const lineaProveedor = await db.prisma.lineaAsiento.findFirstOrThrow({
      where: { monedaOrigen: "USD" },
    });
    expect(new Decimal(lineaProveedor.montoOrigen!).toNumber()).toBe(200); // 2×100 USD
  });

  it("USD con TC quebrado + múltiples categorías: cuadra y montoOrigen×TC == haber al centavo", async () => {
    // TC quebrado y precios que generan residuo de redondeo al agrupar.
    const tc = "1399.50";
    const compraId = await crearCompra(db.prisma, s, {
      moneda: "USD",
      tipoCambio: tc,
      depositoId: s.depositoNacionalId,
      items: [
        {
          productoId: s.productoAId,
          cantidad: 3,
          precioUnitario: "33.33",
          categoriaCuentaId: s.catEstoqueId,
        },
        {
          productoId: s.productoBId,
          cantidad: 7,
          precioUnitario: "11.11",
          categoriaCuentaId: s.catGastoId,
        },
      ],
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(true);

    const asiento = await db.prisma.asiento.findFirstOrThrow({
      where: { lineas: { some: { monedaOrigen: "USD" } } },
      include: { lineas: true },
    });
    const totalDebe = asiento.lineas.reduce((a, l) => a.plus(new Decimal(l.debe)), new Decimal(0));
    const totalHaber = asiento.lineas.reduce(
      (a, l) => a.plus(new Decimal(l.haber)),
      new Decimal(0),
    );
    expect(totalDebe.equals(totalHaber)).toBe(true);

    // El HABER (ARS) == montoOrigen (USD) × TC, redondeado a 2 — subledger USD consistente.
    const prov = asiento.lineas.find((l) => l.monedaOrigen === "USD");
    const haberArs = new Decimal(prov!.haber);
    const montoUsd = new Decimal(prov!.montoOrigen!);
    expect(haberArs.equals(new Decimal(montoUsd).times(tc).toDecimalPlaces(2))).toBe(true);
  });

  it("revierte el estoque al anular (borra MovimientoStock + recalc) y deja la compra CANCELADA", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 10,
          precioUnitario: "150",
          categoriaCuentaId: s.catEstoqueId,
        },
      ],
      depositoId: s.depositoNacionalId,
    });
    expect((await emitirCompraAction(compraId)).ok).toBe(true);
    expect(
      (await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoAId } })).stockActual,
    ).toBe(10);

    const r = await anularCompraAction(compraId);
    expect(r.ok).toBe(true);

    const movs = await db.prisma.movimientoStock.findMany({ where: { productoId: s.productoAId } });
    expect(movs).toHaveLength(0);
    const prod = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoAId } });
    expect(prod.stockActual).toBe(0);
    const compra = await db.prisma.compra.findUniqueOrThrow({ where: { id: compraId } });
    expect(compra.estado).toBe("CANCELADA");
    expect(compra.asientoId).toBeNull();
  });

  it("bloquea la anulación si la compra tiene pagos aplicados (no borra estoque)", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 10,
          precioUnitario: "150",
          categoriaCuentaId: s.catEstoqueId,
        },
      ],
      depositoId: s.depositoNacionalId,
    });
    expect((await emitirCompraAction(compraId)).ok).toBe(true);

    // Simular un pago aplicado a la compra.
    const compra = await db.prisma.compra.findUniqueOrThrow({
      where: { id: compraId },
      select: { asientoId: true },
    });
    const linea = await db.prisma.lineaAsiento.findFirstOrThrow({
      where: { asientoId: compra.asientoId! },
    });
    await db.prisma.aplicacionPagoCompra.create({
      data: { lineaAsientoId: linea.id, compraId, montoArs: "100" },
    });

    const r = await anularCompraAction(compraId);
    expect(r.ok).toBe(false);
    // El estoque queda intacto.
    const prod = await db.prisma.producto.findUniqueOrThrow({ where: { id: s.productoAId } });
    expect(prod.stockActual).toBe(10);
  });

  it("falla al emitir si un ítem capitaliza pero no hay depósito", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 10,
          precioUnitario: "150",
          categoriaCuentaId: s.catEstoqueId,
        },
      ],
      // sin depósito
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("depósito");
    // No quedó asiento (rollback / falla cedo).
    const compra = await db.prisma.compra.findUniqueOrThrow({ where: { id: compraId } });
    expect(compra.estado).toBe("BORRADOR");
    expect(compra.asientoId).toBeNull();
  });

  it("falla al emitir si el depósito no es NACIONAL", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 10,
          precioUnitario: "150",
          categoriaCuentaId: s.catEstoqueId,
        },
      ],
      depositoId: s.depositoZpId,
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(false);
    const compra = await db.prisma.compra.findUniqueOrThrow({ where: { id: compraId } });
    expect(compra.estado).toBe("BORRADOR");
    expect(await db.prisma.movimientoStock.count()).toBe(0);
  });

  it("falla al emitir si la categoría no es imputable (SINTETICA)", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 1,
          precioUnitario: "100",
          categoriaCuentaId: s.catSinteticaId,
        },
      ],
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(false);
  });

  it("no-regresión: compra sólo-gasto (sin depósito) emite sin estoque y cuadra", async () => {
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        {
          productoId: s.productoAId,
          cantidad: 4,
          precioUnitario: "250",
          ivaPct: "21",
          categoriaCuentaId: s.catGastoId,
        },
      ],
    });
    const r = await emitirCompraAction(compraId);
    expect(r.ok).toBe(true);
    expect(await db.prisma.movimientoStock.count()).toBe(0);
    const asiento = await db.prisma.asiento.findFirstOrThrow({ include: { lineas: true } });
    const totalDebe = asiento.lineas.reduce((a, l) => a.plus(new Decimal(l.debe)), new Decimal(0));
    const totalHaber = asiento.lineas.reduce(
      (a, l) => a.plus(new Decimal(l.haber)),
      new Decimal(0),
    );
    expect(totalDebe.equals(totalHaber)).toBe(true);
  });

  it("fallback: ítem sin categoría usa la cuenta por tipoProveedor (1.1.7.01)", async () => {
    // La UI nueva exige categoría; este caso simula un ítem legacy (null) creado
    // directo en BD y emite vía crearAsientoCompra para verificar el fallback.
    const compraId = await crearCompra(db.prisma, s, {
      items: [
        { productoId: s.productoAId, cantidad: 2, precioUnitario: "100", categoriaCuentaId: null },
      ],
    });
    await db.prisma.$transaction((tx) => crearAsientoCompra(compraId, tx));
    const compra = await db.prisma.compra.findUniqueOrThrow({
      where: { id: compraId },
      select: { asientoId: true },
    });
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: compra.asientoId! },
    });
    // El DEBE cae en 1.1.7.01 (gasto por tipoProveedor MERCADERIA_LOCAL).
    const debe = lineas.find((l) => new Decimal(l.debe).gt(0));
    expect(debe!.cuentaId).toBe(s.catEstoqueId);
  });

  it("guardarCompraAction persiste categoriaCuentaId por ítem y depositoId", async () => {
    const res = await guardarCompraAction({
      numero: "C-GUARDAR-1",
      proveedorId: s.proveedorId,
      fecha: "2025-06-15",
      condicionPago: "CUENTA_CORRIENTE",
      moneda: "ARS",
      tipoCambio: "1",
      iibb: "0",
      otros: "0",
      depositoId: s.depositoNacionalId,
      items: [
        {
          productoId: s.productoAId,
          cantidad: 5,
          precioUnitario: "100",
          ivaPorcentaje: "21",
          categoriaCuentaId: s.catEstoqueId,
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const compra = await db.prisma.compra.findUniqueOrThrow({
      where: { id: res.id },
      include: { items: true },
    });
    expect(compra.depositoId).toBe(s.depositoNacionalId);
    expect(compra.items[0].categoriaCuentaId).toBe(s.catEstoqueId);
  });
});
