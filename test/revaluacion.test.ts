import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// MOEDA do Balance/ER — revaluación de posiciones monetarias USD al TC de cierre.
//
// Decisión del dueño (2026-06-17): la línea EXPLÍCITA de diferencia de cambio
// pertenece al Balance/ER (revalúo de posiciones en moneda extranjera al TC de
// cierre, cuentas 4.3.1.02 ganancia / 5.8.1.02 pérdida). Sólo presentación: NO
// graba asiento ("la partida mantiene su moneda nativa"). Se revalúa toda
// posición con saldo USD-nativo (líneas con monedaOrigen=USD en cuentas
// patrimoniales), incluyendo estoque BI.
//
// Principio (en términos brutos deudores, debe−haber):
//   usdBruto   = Σ montoOrigen (lado debe) − Σ montoOrigen (lado haber)
//   arsBrutoUsd = Σ (debe − haber) de las líneas USD
//   revBruta   = usdBruto × TC_cierre − arsBrutoUsd
// Σ revBruta de todas las posiciones = efecto en el resultado del ejercicio.
// Invariante: A = P + PN sigue cerrando (la contrapartida va al resultado).

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

import { Decimal } from "@/lib/decimal";
import { getBalanceGeneralByFecha } from "@/lib/services/reportes/balance-general";
import { getEstadoResultadosByFecha } from "@/lib/services/reportes/estado-resultados";
import { calcularRevaluacionUsd } from "@/lib/services/reportes/revaluacion";
import type { CuentaTreeNode } from "@/lib/services/reportes/shared";

const DESDE = new Date("2025-01-01T00:00:00.000Z");
const HASTA = new Date("2025-12-31T23:59:59.999Z");
const FECHA = new Date("2025-06-10T12:00:00.000Z");

type LineaSeed = {
  cuentaId: number;
  debe?: string;
  haber?: string;
  monedaOrigen?: "USD";
  montoOrigen?: string;
  tipoCambioOrigen?: string;
};

type Cat = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "EGRESO" | "INGRESO";

function findNode(nodes: CuentaTreeNode[], codigo: string): CuentaTreeNode | null {
  for (const n of nodes) {
    if (n.codigo === codigo) return n;
    const f = findNode(n.children, codigo);
    if (f) return f;
  }
  return null;
}

describe("MOEDA balance/ER — revaluación de posiciones USD al TC de cierre", () => {
  let db: TestDb;
  let periodoId: number;
  let numeroSeq = 0;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.reset(["LineaAsiento", "Asiento", "PeriodoContable", "CuentaContable", "Cotizacion"]);
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025",
        nombre: "Ejercicio 2025",
        fechaInicio: new Date("2025-01-01T00:00:00.000Z"),
        fechaFin: new Date("2025-12-31T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });
    periodoId = periodo.id;
  });

  async function mkCuenta(codigo: string, nombre: string, categoria: Cat): Promise<number> {
    const c = await db.prisma.cuentaContable.create({
      data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4, padreCodigo: null },
    });
    return c.id;
  }

  async function mkCotizacion(fecha: string, valor: number): Promise<void> {
    await db.prisma.cotizacion.create({
      data: { fecha: new Date(fecha), valor: valor.toFixed(6), fuente: "test" },
    });
  }

  async function mkAsiento(lineas: LineaSeed[]): Promise<void> {
    numeroSeq += 1;
    const totalDebe = lineas.reduce((s, l) => s + Number(l.debe ?? 0), 0);
    const totalHaber = lineas.reduce((s, l) => s + Number(l.haber ?? 0), 0);
    await db.prisma.asiento.create({
      data: {
        numero: numeroSeq,
        fecha: FECHA,
        descripcion: `asiento ${numeroSeq}`,
        estado: "CONTABILIZADO",
        origen: "MANUAL",
        moneda: "ARS",
        tipoCambio: "1",
        totalDebe: totalDebe.toFixed(2),
        totalHaber: totalHaber.toFixed(2),
        periodoId,
        lineas: {
          create: lineas.map((l) => ({
            cuentaId: l.cuentaId,
            debe: l.debe ?? "0",
            haber: l.haber ?? "0",
            monedaOrigen: l.monedaOrigen ?? null,
            montoOrigen: l.montoOrigen ?? null,
            tipoCambioOrigen: l.tipoCambioOrigen ?? null,
          })),
        },
      },
    });
  }

  // Compra al exterior: estoque debe / proveedor haber, ambos USD al mismo TC.
  async function compraExterior(estoque: number, proveedor: number, usd: number, tc: number) {
    const ars = (usd * tc).toFixed(2);
    await mkAsiento([
      {
        cuentaId: estoque,
        debe: ars,
        monedaOrigen: "USD",
        montoOrigen: usd.toFixed(2),
        tipoCambioOrigen: tc.toFixed(6),
      },
      {
        cuentaId: proveedor,
        haber: ars,
        monedaOrigen: "USD",
        montoOrigen: usd.toFixed(2),
        tipoCambioOrigen: tc.toFixed(6),
      },
    ]);
  }

  it("1) helper: ejemplo del dueño — proveedor exterior 2 facturas → −60.000 (pérdida)", async () => {
    const estoque = await mkCuenta("1.1.7.01", "MERCADERIAS", "ACTIVO");
    const proveedor = await mkCuenta("2.1.8.01", "PROVEEDORES DEL EXTERIOR", "PASIVO");
    // USD 100 @ 1000 y USD 100 @ 1200 → saldo USD 200 / ARS 220.000.
    await compraExterior(estoque, proveedor, 100, 1000);
    await compraExterior(estoque, proveedor, 100, 1200);

    const rev = await calcularRevaluacionUsd(HASTA, new Decimal(1400));
    // proveedor: −200×1400 − (−220.000) = −60.000 (pasivo creció en ARS → pérdida).
    expect(rev.porCuenta.get(proveedor)?.toNumber()).toBeCloseTo(-60000, 2);
    // estoque: +200×1400 − 220.000 = +60.000.
    expect(rev.porCuenta.get(estoque)?.toNumber()).toBeCloseTo(60000, 2);
    // total neto = 0 (activo y pasivo se mueven igual y opuesto).
    expect(rev.total.toNumber()).toBeCloseTo(0, 2);
  });

  it("1b) helper: sin TC → revaluación vacía", async () => {
    const estoque = await mkCuenta("1.1.7.01", "MERCADERIAS", "ACTIVO");
    const proveedor = await mkCuenta("2.1.8.01", "PROVEEDORES DEL EXTERIOR", "PASIVO");
    await compraExterior(estoque, proveedor, 100, 1000);

    const rev = await calcularRevaluacionUsd(HASTA, null);
    expect(rev.porCuenta.size).toBe(0);
    expect(rev.total.toNumber()).toBe(0);
  });

  it("2) balance revaluado: posiciones suben y A = P + PN sigue cerrando", async () => {
    const banco = await mkCuenta("1.1.2.02", "BANCO USD", "ACTIVO");
    const estoque = await mkCuenta("1.1.7.01", "MERCADERIAS", "ACTIVO");
    const proveedor = await mkCuenta("2.1.8.01", "PROVEEDORES DEL EXTERIOR", "PASIVO");
    const capital = await mkCuenta("3.1.1.01", "CAPITAL", "PATRIMONIO");
    await mkCotizacion("2025-12-31", 1400);

    // Aporte: banco USD 100 @ 1000 (ARS 100.000) contra capital (ARS).
    await mkAsiento([
      {
        cuentaId: banco,
        debe: "100000.00",
        monedaOrigen: "USD",
        montoOrigen: "100.00",
        tipoCambioOrigen: "1000",
      },
      { cuentaId: capital, haber: "100000.00" },
    ]);
    // Dos compras al exterior (estoque + proveedor): USD 100 @ 1000 y 100 @ 1200.
    await compraExterior(estoque, proveedor, 100, 1000);
    await compraExterior(estoque, proveedor, 100, 1200);

    const bg = await getBalanceGeneralByFecha({ fechaHasta: HASTA });

    // banco: 100.000 + (100×1400 − 100.000)=+40.000 → 140.000.
    // estoque: 220.000 + (200×1400 − 220.000)=+60.000 → 280.000.
    // proveedor: 220.000 + 60.000 → 280.000. capital: 100.000. resultado: +40.000.
    expect(bg.totalActivo.toNumber()).toBeCloseTo(420000, 2);
    expect(bg.totalPasivo.toNumber()).toBeCloseTo(280000, 2);
    expect(bg.difCambioNoRealizada.toNumber()).toBeCloseTo(40000, 2);
    expect(bg.resultadoEjercicio.toNumber()).toBeCloseTo(40000, 2);
    expect(bg.totalPatrimonioAjustado.toNumber()).toBeCloseTo(140000, 2);
    expect(bg.cuadra).toBe(true);
    expect(bg.tipoCambioCierre?.toNumber()).toBe(1400);
  });

  it("3) presentación USD: saldo ARS revaluado ÷ TC recupera el nativo en USD", async () => {
    const banco = await mkCuenta("1.1.2.02", "BANCO USD", "ACTIVO");
    const estoque = await mkCuenta("1.1.7.01", "MERCADERIAS", "ACTIVO");
    const proveedor = await mkCuenta("2.1.8.01", "PROVEEDORES DEL EXTERIOR", "PASIVO");
    const capital = await mkCuenta("3.1.1.01", "CAPITAL", "PATRIMONIO");
    await mkCotizacion("2025-12-31", 1400);

    await mkAsiento([
      {
        cuentaId: banco,
        debe: "100000.00",
        monedaOrigen: "USD",
        montoOrigen: "100.00",
        tipoCambioOrigen: "1000",
      },
      { cuentaId: capital, haber: "100000.00" },
    ]);
    await compraExterior(estoque, proveedor, 100, 1000);
    await compraExterior(estoque, proveedor, 100, 1200);

    const bg = await getBalanceGeneralByFecha({ fechaHasta: HASTA });
    const tc = 1400;
    // banco USD: 140.000 / 1400 = 100 USD (nativo). proveedor: 280.000 / 1400 = 200 USD.
    const bancoNode = findNode(bg.activo, "1.1.2.02");
    const provNode = findNode(bg.pasivo, "2.1.8.01");
    expect(bancoNode).not.toBeNull();
    expect(provNode).not.toBeNull();
    expect((bancoNode?.saldo.toNumber() ?? 0) / tc).toBeCloseTo(100, 2);
    expect((provNode?.saldo.toNumber() ?? 0) / tc).toBeCloseTo(200, 2);
  });

  it("4) ER: línea de dif. de cambio no realizada se suma a la realizada (sin doble conteo)", async () => {
    const estoque = await mkCuenta("1.1.7.01", "MERCADERIAS", "ACTIVO");
    const proveedor = await mkCuenta("2.1.8.01", "PROVEEDORES DEL EXTERIOR", "PASIVO");
    const banco = await mkCuenta("1.1.2.01", "BANCO ARS", "ACTIVO");
    const perdidaFx = await mkCuenta("5.8.1.02", "PERDIDA POR DIFERENCIA DE CAMBIO", "EGRESO");
    await mkCotizacion("2025-12-31", 1400);

    // No realizada: estoque +60.000 / proveedor −60.000 → total 0 (se anulan).
    await compraExterior(estoque, proveedor, 100, 1000);
    await compraExterior(estoque, proveedor, 100, 1200);
    // Para un total ≠ 0, agrego una posición de activo neta (banco USD vía estoque sólo).
    // Realizada (Fase 2): pérdida 10.000 ya contabilizada en 5.8.1.02.
    await mkAsiento([
      { cuentaId: perdidaFx, debe: "10000.00" },
      { cuentaId: banco, haber: "10000.00" },
    ]);

    const er = await getEstadoResultadosByFecha({ fechaDesde: DESDE, fechaHasta: HASTA });
    // No realizada total = 0 (estoque +60k / proveedor −60k).
    expect(er.difCambioNoRealizada.toNumber()).toBeCloseTo(0, 2);
    // FINANCIEROS = realizada (−10.000) + no realizada (0) = −10.000.
    const fin = er.rt9.secciones.find((s) => s.id === "FINANCIEROS");
    expect(fin?.total.toNumber()).toBeCloseTo(-10000, 2);
  });

  it("4b) ER: ganancia no realizada aparece como línea explícita y entra al resultado", async () => {
    const banco = await mkCuenta("1.1.2.02", "BANCO USD", "ACTIVO");
    const capital = await mkCuenta("3.1.1.01", "CAPITAL", "PATRIMONIO");
    await mkCotizacion("2025-12-31", 1400);
    // Banco USD 100 @ 1000 → revBruta = +40.000 (ganancia no realizada).
    await mkAsiento([
      {
        cuentaId: banco,
        debe: "100000.00",
        monedaOrigen: "USD",
        montoOrigen: "100.00",
        tipoCambioOrigen: "1000",
      },
      { cuentaId: capital, haber: "100000.00" },
    ]);

    const er = await getEstadoResultadosByFecha({ fechaDesde: DESDE, fechaHasta: HASTA });
    expect(er.difCambioNoRealizada.toNumber()).toBeCloseTo(40000, 2);
    expect(er.resultado.toNumber()).toBeCloseTo(40000, 2);
    const fin = er.rt9.secciones.find((s) => s.id === "FINANCIEROS");
    expect(fin?.total.toNumber()).toBeCloseTo(40000, 2);
    // La ganancia se expone en la lista de ingresos (nodo sintético).
    const totalIngresos = er.totalIngresos.toNumber();
    expect(totalIngresos).toBeCloseTo(40000, 2);
  });

  it("5) sin cotización: no revalúa, advertencia, balance en ARS histórico cuadra", async () => {
    const banco = await mkCuenta("1.1.2.02", "BANCO USD", "ACTIVO");
    const estoque = await mkCuenta("1.1.7.01", "MERCADERIAS", "ACTIVO");
    const proveedor = await mkCuenta("2.1.8.01", "PROVEEDORES DEL EXTERIOR", "PASIVO");
    const capital = await mkCuenta("3.1.1.01", "CAPITAL", "PATRIMONIO");
    // (sin mkCotizacion → no hay TC)
    await mkAsiento([
      {
        cuentaId: banco,
        debe: "100000.00",
        monedaOrigen: "USD",
        montoOrigen: "100.00",
        tipoCambioOrigen: "1000",
      },
      { cuentaId: capital, haber: "100000.00" },
    ]);
    await compraExterior(estoque, proveedor, 100, 1000);

    const bg = await getBalanceGeneralByFecha({ fechaHasta: HASTA });
    expect(bg.tipoCambioCierre).toBeNull();
    expect(bg.difCambioNoRealizada.toNumber()).toBe(0);
    // ARS histórico: activo 200.000, pasivo 100.000, PN 100.000 → cuadra.
    expect(bg.totalActivo.toNumber()).toBeCloseTo(200000, 2);
    expect(bg.cuadra).toBe(true);
    expect(bg.advertencias.length).toBeGreaterThanOrEqual(1);
    expect(bg.advertencias.some((a) => /cotizaci/i.test(a))).toBe(true);
  });

  it("6) estoque BI: sólo la parte USD se revalúa; la parte ARS no", async () => {
    const estoque = await mkCuenta("1.1.7.02", "ESTOQUE A DESPACHAR", "ACTIVO");
    const proveedor = await mkCuenta("2.1.8.01", "PROVEEDORES DEL EXTERIOR", "PASIVO");
    const bancoArs = await mkCuenta("1.1.2.01", "BANCO ARS", "ACTIVO");
    await mkCotizacion("2025-12-31", 1400);

    // Parte USD: 100 @ 1000 (ARS 100.000) contra proveedor exterior.
    await compraExterior(estoque, proveedor, 100, 1000);
    // Parte ARS pura: 50.000 (sin monedaOrigen) contra banco ARS.
    await mkAsiento([
      { cuentaId: estoque, debe: "50000.00" },
      { cuentaId: bancoArs, haber: "50000.00" },
    ]);

    const rev = await calcularRevaluacionUsd(HASTA, new Decimal(1400));
    // estoque: sólo parte USD → 100×1400 − 100.000 = +40.000 (la parte ARS no entra).
    expect(rev.porCuenta.get(estoque)?.toNumber()).toBeCloseTo(40000, 2);
    // banco ARS no tiene líneas USD → no aparece.
    expect(rev.porCuenta.has(bancoArs)).toBe(false);
  });

  it("7) sin posiciones USD: revaluación 0, no-regresión del balance/ER", async () => {
    const banco = await mkCuenta("1.1.2.01", "BANCO ARS", "ACTIVO");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTES", "ACTIVO");
    const capital = await mkCuenta("3.1.1.01", "CAPITAL", "PATRIMONIO");
    await mkCotizacion("2025-12-31", 1400);
    await mkAsiento([
      { cuentaId: banco, debe: "300000.00" },
      { cuentaId: capital, haber: "300000.00" },
    ]);
    await mkAsiento([
      { cuentaId: cliente, debe: "120000.00" },
      { cuentaId: banco, haber: "120000.00" },
    ]);

    const bg = await getBalanceGeneralByFecha({ fechaHasta: HASTA });
    expect(bg.difCambioNoRealizada.toNumber()).toBe(0);
    expect(bg.totalActivo.toNumber()).toBeCloseTo(300000, 2); // 180.000 banco + 120.000 cliente
    expect(bg.cuadra).toBe(true);
    expect(bg.advertencias.length).toBe(0);

    const er = await getEstadoResultadosByFecha({ fechaDesde: DESDE, fechaHasta: HASTA });
    expect(er.difCambioNoRealizada.toNumber()).toBe(0);
    const fin = er.rt9.secciones.find((s) => s.id === "FINANCIEROS");
    expect(fin?.total.toNumber()).toBe(0);
  });

  it("8) consistencia balance ↔ ER: el resultado del ejercicio coincide (en ARS)", async () => {
    const banco = await mkCuenta("1.1.2.02", "BANCO USD", "ACTIVO");
    const capital = await mkCuenta("3.1.1.01", "CAPITAL", "PATRIMONIO");
    await mkCotizacion("2025-12-31", 1400);
    await mkAsiento([
      {
        cuentaId: banco,
        debe: "100000.00",
        monedaOrigen: "USD",
        montoOrigen: "100.00",
        tipoCambioOrigen: "1000",
      },
      { cuentaId: capital, haber: "100000.00" },
    ]);

    const bg = await getBalanceGeneralByFecha({ fechaHasta: HASTA });
    const er = await getEstadoResultadosByFecha({ fechaDesde: DESDE, fechaHasta: HASTA });
    expect(bg.resultadoEjercicio.toNumber()).toBeCloseTo(er.resultado.toNumber(), 2);
    expect(bg.difCambioNoRealizada.toNumber()).toBeCloseTo(er.difCambioNoRealizada.toNumber(), 2);
  });
});
