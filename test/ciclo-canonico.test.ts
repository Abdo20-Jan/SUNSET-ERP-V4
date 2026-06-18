import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "decimal.js";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// E7 (PE.8) — Ciclo canónico de pago exterior USD + smoke de los 4 paths de pago.
//
// Cierra la FASE A. Ancla el ejemplo canónico de la regla de negocio (memoria
// regra-pago-exterior-usd):
//
//   factura USD 25.000 @ TC 1.200 → HABER proveedor ARS 30.000.000 (montoOrigen
//   USD 25.000). Pago a TC banco 1.300 → DEBE proveedor 30.000.000 (al TC
//   histórico) + DEBE pérdida 2.500.000 (9.2.02) / HABER banco 32.500.000.
//   Saldo USD del proveedor = 0; el BALANCETE queda invariante (lo que cambia
//   son los pesos, el dólar no).
//
// Cobertura NUEVA vs los tests por-path (pago-exterior-action, diferencia-
// cambiaria-*, prestamo-saldo-usd): ninguno verifica el ciclo completo
// factura→pago reflejado en el BALANCETE (getBalanceSumasYSaldos): que el saldo
// USD del proveedor vuelve a 0 (invariante a TC) y que el balancete cuadra.

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

import { AsientoEstado, AsientoOrigen, Moneda } from "@/generated/prisma/client";
import { pagarFacturaExteriorAction } from "@/lib/actions/pago-exterior";
import {
  crearMovimientoTesoreriaAction,
  pagarConIntermediarioAction,
} from "@/lib/actions/movimientos-tesoreria";
import { getBalanceSumasYSaldos, type BalanceNode } from "@/lib/services/balance-sumas-saldos";

const FECHA_FACTURA = new Date("2025-06-01T12:00:00.000Z");
const FECHA_PAGO = new Date("2025-06-20T12:00:00.000Z");
const FECHA_HASTA = new Date("2025-06-30T23:59:59.000Z");

const TABLES = [
  "AplicacionPagoCompra",
  "AplicacionPagoEmbarqueCosto",
  "AplicacionPagoGasto",
  "MovimientoTesoreria",
  "LineaAsiento",
  "Asiento",
  "ItemCompra",
  "Compra",
  "CuentaBancaria",
  "Proveedor",
  "PeriodoContable",
  "CuentaContable",
] as const;

interface Seed {
  cuentaBancariaArsId: string;
  cuentaBancariaUsdId: string;
  cuentaBancoArsContableId: number;
  cuentaBancoUsdContableId: number;
  proveedorExteriorId: string;
  cuentaProvExtId: number;
  cuentaProvAId: number;
  cuentaProvBId: number;
  cuentaBeneficiarioId: number;
  cuentaContraId: number;
  periodoId: number;
}

let testDb: TestDb;
let prisma: PrismaClient;

beforeAll(async () => {
  testDb = await createTestDb();
  prisma = testDb.prisma;
  h.setClient(prisma);
}, 120_000);

afterAll(async () => {
  await testDb?.stop();
});

let s: Seed;
// Numeración determinística de los asientos de booking (evita colisión de
// [periodoId, numero] que un random podría provocar entre dos bookFactura del
// mismo período — p. ej. el path multi). El pago siempre usa MAX(numero)+1,
// estrictamente mayor que cualquier booking.
let bookSeq = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  await testDb.reset(TABLES);
  bookSeq = 0;
  s = await seed();
});

async function seed(): Promise<Seed> {
  const periodo = await prisma.periodoContable.create({
    data: {
      codigo: "2025-06",
      nombre: "Junio 2025",
      fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
      fechaFin: new Date("2025-06-30T23:59:59.000Z"),
      estado: "ABIERTO",
    },
  });

  const mkCuenta = (
    codigo: string,
    nombre: string,
    categoria: "ACTIVO" | "PASIVO" | "EGRESO",
    nivel = 4,
  ) =>
    prisma.cuentaContable.create({
      data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel },
    });

  const bancoArs = await mkCuenta("1.1.1.02.10", "BANCO ARS", "ACTIVO", 5);
  const bancoUsd = await mkCuenta("1.1.1.02.11", "BANCO USD", "ACTIVO", 5);
  const provExt = await mkCuenta("2.1.1.02.01", "PROVEEDOR EXTERIOR", "PASIVO", 5);
  const provA = await mkCuenta("2.1.1.10", "PROVEEDOR A USD", "PASIVO");
  const provB = await mkCuenta("2.1.1.11", "PROVEEDOR B USD", "PASIVO");
  const beneficiario = await mkCuenta("2.1.1.20", "INTERMEDIARIO", "PASIVO");
  const contra = await mkCuenta("1.1.7.01", "MERCADERÍAS", "ACTIVO");

  // Sintéticas padre para auto-create de la diferencia (ULTRA clase 9).
  await prisma.cuentaContable.createMany({
    data: [
      {
        codigo: "9",
        nombre: "RESULTADOS FINANCIEROS Y POR TENENCIA",
        tipo: "SINTETICA",
        categoria: "INGRESO",
        nivel: 1,
      },
      {
        codigo: "9.2",
        nombre: "DIFERENCIAS DE CAMBIO",
        tipo: "SINTETICA",
        categoria: "INGRESO",
        nivel: 2,
      },
    ],
  });

  const cuentaBancariaArs = await prisma.cuentaBancaria.create({
    data: {
      banco: "Banco ARS",
      tipo: "CUENTA_CORRIENTE",
      moneda: Moneda.ARS,
      numero: "0001-0001",
      cuentaContableId: bancoArs.id,
    },
  });
  const cuentaBancariaUsd = await prisma.cuentaBancaria.create({
    data: {
      banco: "Banco USD",
      tipo: "CUENTA_CORRIENTE",
      moneda: Moneda.USD,
      numero: "0002-0002",
      cuentaContableId: bancoUsd.id,
    },
  });

  const proveedorExterior = await prisma.proveedor.create({
    data: {
      nombre: "SUNSET PARAGUAY",
      tipoProveedor: "MERCADERIA_EXTERIOR",
      pais: "PY",
      cuentaContableId: provExt.id,
    },
  });

  return {
    cuentaBancariaArsId: cuentaBancariaArs.id,
    cuentaBancariaUsdId: cuentaBancariaUsd.id,
    cuentaBancoArsContableId: bancoArs.id,
    cuentaBancoUsdContableId: bancoUsd.id,
    proveedorExteriorId: proveedorExterior.id,
    cuentaProvExtId: provExt.id,
    cuentaProvAId: provA.id,
    cuentaProvBId: provB.id,
    cuentaBeneficiarioId: beneficiario.id,
    cuentaContraId: contra.id,
    periodoId: periodo.id,
  };
}

/**
 * Lanza una factura USD: asiento contabilizado con HABER USD-nato en la cuenta
 * del proveedor (deja el pasivo pendiente al TC factura) y DEBE en la
 * contrapartida (mercaderías), sin metadata. Es el "booking" del pasivo, previo
 * al pago.
 */
async function bookFactura(
  cuentaProveedorId: number,
  usd: number,
  tc: number,
  fecha: Date = FECHA_FACTURA,
  descripcion = "Factura test",
): Promise<void> {
  const ars = (usd * tc).toFixed(2);
  bookSeq += 1;
  await prisma.asiento.create({
    data: {
      numero: bookSeq,
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
          { cuentaId: s.cuentaContraId, debe: ars, haber: 0, descripcion: "Mercaderías" },
          {
            cuentaId: cuentaProveedorId,
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

/** Busca recursiva de un nodo por código en el árbol del balance. */
function findNode(nodes: BalanceNode[], codigo: string): BalanceNode | undefined {
  for (const n of nodes) {
    if (n.codigo === codigo) return n;
    if (n.children) {
      const found = findNode(n.children, codigo);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Saldo USD de una cuenta directamente desde la metadata (fórmula canónica:
 * Σ montoOrigen(haber) − Σ montoOrigen(debe) sobre líneas CONTABILIZADO).
 * Invariante a TC; independiente de tcParaUsd del balance.
 */
async function saldoUsdCuenta(cuentaId: number): Promise<Decimal> {
  const lineas = await prisma.lineaAsiento.findMany({
    where: {
      cuentaId,
      monedaOrigen: Moneda.USD,
      asiento: { estado: AsientoEstado.CONTABILIZADO },
    },
    select: { debe: true, haber: true, montoOrigen: true },
  });
  let saldo = new Decimal(0);
  for (const l of lineas) {
    const mo = new Decimal(l.montoOrigen ?? 0);
    if (new Decimal(l.haber).gt(0)) saldo = saldo.plus(mo);
    if (new Decimal(l.debe).gt(0)) saldo = saldo.minus(mo);
  }
  return saldo;
}

/** Identidad del trial balance: Σ debe == Σ haber sobre las hojas ANALÍTICA. */
function expectBalanceteCuadra(root: BalanceNode[]): void {
  let totalDebe = new Decimal(0);
  let totalHaber = new Decimal(0);
  const walk = (n: BalanceNode): void => {
    if (n.tipo === "ANALITICA") {
      totalDebe = totalDebe.plus(new Decimal(n.debe));
      totalHaber = totalHaber.plus(new Decimal(n.haber));
    }
    for (const c of n.children ?? []) walk(c);
  };
  for (const n of root) walk(n);
  expect(totalDebe.minus(totalHaber).abs().lessThan(new Decimal("0.01"))).toBe(true);
}

async function lineasDe(asientoId: string) {
  return prisma.lineaAsiento.findMany({
    where: { asientoId },
    include: { cuenta: { select: { codigo: true } } },
    orderBy: { id: "asc" },
  });
}

function asientoBalanceado(lineas: Array<{ debe: unknown; haber: unknown }>): boolean {
  let d = new Decimal(0);
  let hb = new Decimal(0);
  for (const l of lineas) {
    d = d.plus(new Decimal(String(l.debe)));
    hb = hb.plus(new Decimal(String(l.haber)));
  }
  return d.minus(hb).abs().lessThan(new Decimal("0.01"));
}

// ============================================================
// Bloque 1 — Ciclo canónico (centerpiece)
// ============================================================

describe("E7 — ciclo canónico (factura USD 25.000 @1200 → pago @1300)", () => {
  it("DEBE prov 30M (histórico) + HABER banco 32.5M + pérdida 9.2.02 2.5M; saldo USD prov = 0; balancete cuadra", async () => {
    // Factura: Compra USD 25.000 @ TC 1.200 + booking del pasivo.
    const compra = await prisma.compra.create({
      data: {
        numero: "INV-CANON-001",
        proveedorId: s.proveedorExteriorId,
        fecha: FECHA_FACTURA,
        moneda: "USD",
        tipoCambio: "1200.000000",
        subtotal: "25000.00",
        iva: "0",
        iibb: "0",
        otros: "0",
        total: "25000.00",
        estado: "EMITIDA",
      },
    });
    await bookFactura(s.cuentaProvExtId, 25000, 1200, FECHA_FACTURA, "INV-CANON-001");

    // Pago: TC banco 1.300.
    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "compra",
      facturaId: compra.id,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1300.000000",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    expect(Number(res.montoUsd)).toBeCloseTo(25000, 2);
    expect(Number(res.montoArs)).toBeCloseTo(32500000, 2);
    expect(Number(res.tipoCambioAplicado)).toBeCloseTo(1300, 6);

    // Asiento del pago: 3 líneas.
    const lineas = await lineasDe(res.asientoId);
    expect(lineas).toHaveLength(3);
    expect(asientoBalanceado(lineas)).toBe(true);

    const debeProv = lineas.find((l) => l.cuentaId === s.cuentaProvExtId);
    if (!debeProv) throw new Error("falta línea DEBE proveedor");
    expect(Number(debeProv.debe)).toBeCloseTo(30000000, 2); // 25.000 × 1.200 (histórico)
    expect(debeProv.monedaOrigen).toBe("USD");
    expect(Number(debeProv.montoOrigen)).toBeCloseTo(25000, 2);
    expect(Number(debeProv.tipoCambioOrigen)).toBeCloseTo(1200, 6);

    const banco = lineas.find((l) => l.cuentaId === s.cuentaBancoArsContableId);
    if (!banco) throw new Error("falta línea banco");
    expect(Number(banco.haber)).toBeCloseTo(32500000, 2); // 25.000 × 1.300 (pago)

    const perdida = lineas.find((l) => l.cuenta.codigo === "9.2.02");
    if (!perdida) throw new Error("falta línea pérdida 9.2.02");
    expect(Number(perdida.debe)).toBeCloseTo(2500000, 2); // 32.5M − 30M
    expect(lineas.some((l) => l.cuenta.codigo === "9.2.01")).toBe(false);

    // Saldo USD del proveedor = 0 (booking HABER 25.000 − pago DEBE 25.000).
    expect((await saldoUsdCuenta(s.cuentaProvExtId)).toFixed(2)).toBe("0.00");

    // Balancete: proveedor cierra en 0 (ARS y USD); pérdida = 2.5M; cuadra.
    const { root } = await getBalanceSumasYSaldos({
      fechaHasta: FECHA_HASTA,
      tcParaUsd: "1300",
    });
    const nodeProv = findNode(root, "2.1.1.02.01");
    if (!nodeProv) throw new Error("falta nodo proveedor en el balance");
    expect(Number(nodeProv.saldoFinal)).toBeCloseTo(0, 2);
    expect(nodeProv.saldoFinalUsd === null ? 0 : Number(nodeProv.saldoFinalUsd)).toBeCloseTo(0, 2);

    const nodePerdida = findNode(root, "9.2.02");
    if (!nodePerdida) throw new Error("falta nodo 9.2.02 en el balance");
    expect(Number(nodePerdida.debe)).toBeCloseTo(2500000, 2);

    expectBalanceteCuadra(root);
  });
});

// ============================================================
// Bloque 2 — Smoke de los 4 paths de pago USD (foco: balancete invariante)
// ============================================================

describe("E7 — smoke 4 paths de pago USD (balancete invariante)", () => {
  it("path 1 — pagarFacturaExteriorAction (banco ARS): saldo USD prov = 0; cuadra", async () => {
    const compra = await prisma.compra.create({
      data: {
        numero: "INV-P1",
        proveedorId: s.proveedorExteriorId,
        fecha: FECHA_FACTURA,
        moneda: "USD",
        tipoCambio: "1000.000000",
        subtotal: "5000.00",
        iva: "0",
        iibb: "0",
        otros: "0",
        total: "5000.00",
        estado: "EMITIDA",
      },
    });
    await bookFactura(s.cuentaProvExtId, 5000, 1000, FECHA_FACTURA, "INV-P1");

    const res = await pagarFacturaExteriorAction({
      facturaOrigen: "compra",
      facturaId: compra.id,
      cuentaBancariaArsId: s.cuentaBancariaArsId,
      tipoCambioBanco: "1100.000000",
      fecha: FECHA_PAGO,
    });
    if (!res.ok) throw new Error(`pago falló: ${res.error}`);

    const lineas = await lineasDe(res.asientoId);
    expect(asientoBalanceado(lineas)).toBe(true);
    expect(lineas.some((l) => l.cuenta.codigo === "9.2.02")).toBe(true); // pérdida (1100>1000)
    expect((await saldoUsdCuenta(s.cuentaProvExtId)).toFixed(2)).toBe("0.00");

    const { root } = await getBalanceSumasYSaldos({ fechaHasta: FECHA_HASTA, tcParaUsd: "1100" });
    expectBalanceteCuadra(root);
  });

  it("path 2 — crearMovimientoTesoreriaAction multi-contrapartida: ambos prov USD = 0; cuadra", async () => {
    await bookFactura(s.cuentaProvAId, 1000, 1200, FECHA_FACTURA, "F-A");
    await bookFactura(s.cuentaProvBId, 2000, 1100, FECHA_FACTURA, "F-B");

    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: FECHA_PAGO,
      moneda: "USD",
      tipoCambio: "1300",
      lineas: [
        { cuentaContableId: s.cuentaProvAId, monto: "1000.00" },
        { cuentaContableId: s.cuentaProvBId, monto: "2000.00" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    expect(asientoBalanceado(lineas)).toBe(true);
    expect(lineas.some((l) => l.cuenta.codigo === "9.2.02")).toBe(true);
    expect((await saldoUsdCuenta(s.cuentaProvAId)).toFixed(2)).toBe("0.00");
    expect((await saldoUsdCuenta(s.cuentaProvBId)).toFixed(2)).toBe("0.00");

    const { root } = await getBalanceSumasYSaldos({ fechaHasta: FECHA_HASTA, tcParaUsd: "1300" });
    expectBalanceteCuadra(root);
  });

  it("path 3 — pagarConIntermediarioAction (exacto): prov USD = 0; cuadra", async () => {
    await bookFactura(s.cuentaProvAId, 1000, 1200, FECHA_FACTURA, "F-INT");

    const r = await pagarConIntermediarioAction({
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: FECHA_PAGO,
      moneda: "USD",
      tipoCambio: "1300",
      montoTransferido: "1000.00", // exacto = Σ facturas
      facturas: [{ cuentaContableId: s.cuentaProvAId, monto: "1000.00" }],
      beneficiarioCuentaId: s.cuentaBeneficiarioId,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    expect(asientoBalanceado(lineas)).toBe(true);
    expect(lineas.some((l) => l.cuenta.codigo === "9.2.02")).toBe(true);
    expect((await saldoUsdCuenta(s.cuentaProvAId)).toFixed(2)).toBe("0.00");

    const { root } = await getBalanceSumasYSaldos({ fechaHasta: FECHA_HASTA, tcParaUsd: "1300" });
    expectBalanceteCuadra(root);
  });

  it("path 4 — crearMovimientoTesoreriaAction single contrapartida: prov USD = 0; cuadra", async () => {
    await bookFactura(s.cuentaProvAId, 4000, 1150, FECHA_FACTURA, "F-SINGLE");

    const r = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId: s.cuentaBancariaUsdId,
      fecha: FECHA_PAGO,
      moneda: "USD",
      tipoCambio: "1300",
      lineas: [{ cuentaContableId: s.cuentaProvAId, monto: "4000.00" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const lineas = await lineasDe(r.asientoId);
    expect(asientoBalanceado(lineas)).toBe(true);
    expect(lineas.some((l) => l.cuenta.codigo === "9.2.02")).toBe(true);
    expect((await saldoUsdCuenta(s.cuentaProvAId)).toFixed(2)).toBe("0.00");

    const { root } = await getBalanceSumasYSaldos({ fechaHasta: FECHA_HASTA, tcParaUsd: "1300" });
    expectBalanceteCuadra(root);
  });
});
