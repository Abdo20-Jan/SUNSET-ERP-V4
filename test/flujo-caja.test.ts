import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// MOEDA do flujo — Flujo de Caja CONSOLIDADO + CONVERTIDO al TC de cierre.
//
// Decisión del dueño (2026-06-17): el flujo se presenta CONSOLIDANDO todas las
// cuentas banco/caja y CONVIRTIENDO a la moneda de presentación (USD por
// defecto) usando "todo al TC de cierre" = la última `Cotizacion` con
// `fecha <= hasta`. No hay línea de diferencia de cambio en el flujo (todo a la
// misma tasa). Invariante: saldoFinal == Σ saldos de banco (en su moneda nativa)
// convertidos al TC de cierre.
//
// También cubre los fixes FC-2: el corte sub-centavo no debe perder dinero y el
// rollup de sintéticas debe coincidir con la suma de sus analíticas.

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

import { calcularSaldosCuentasBancariasEnMonedaCuenta } from "@/lib/services/cuenta-bancaria";
import { type FlujoNode, getFlujoCaja } from "@/lib/services/reportes/flujo-caja";

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

function convertirNum(
  valor: number,
  origen: "ARS" | "USD",
  destino: "ARS" | "USD",
  tc: number,
): number {
  if (origen === destino) return valor;
  if (origen === "USD" && destino === "ARS") return valor * tc;
  return tc === 0 ? 0 : valor / tc;
}

function findNode(nodes: FlujoNode[], codigo: string): FlujoNode | null {
  for (const n of nodes) {
    if (n.codigo === codigo) return n;
    const f = findNode(n.children, codigo);
    if (f) return f;
  }
  return null;
}

describe("MOEDA flujo — consolidado + convertido al TC de cierre", () => {
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
    await db.reset([
      "LineaAsiento",
      "Asiento",
      "CuentaBancaria",
      "PeriodoContable",
      "CuentaContable",
      "Cotizacion",
    ]);
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

  async function mkCuenta(
    codigo: string,
    nombre: string,
    categoria: "ACTIVO" | "PASIVO" | "EGRESO" | "INGRESO",
    padreCodigo?: string,
  ): Promise<number> {
    const c = await db.prisma.cuentaContable.create({
      data: {
        codigo,
        nombre,
        tipo: "ANALITICA",
        categoria,
        nivel: 4,
        padreCodigo: padreCodigo ?? null,
      },
    });
    return c.id;
  }

  async function mkSintetica(
    codigo: string,
    nombre: string,
    categoria: "ACTIVO" | "PASIVO" | "EGRESO" | "INGRESO",
    nivel: number,
    padreCodigo?: string,
  ): Promise<number> {
    const c = await db.prisma.cuentaContable.create({
      data: {
        codigo,
        nombre,
        tipo: "SINTETICA",
        categoria,
        nivel,
        padreCodigo: padreCodigo ?? null,
      },
    });
    return c.id;
  }

  async function mkBanco(codigo: string, nombre: string, moneda: "ARS" | "USD"): Promise<number> {
    const id = await mkCuenta(codigo, nombre, "ACTIVO");
    await db.prisma.cuentaBancaria.create({
      data: {
        banco: nombre,
        tipo: "CUENTA_CORRIENTE",
        moneda,
        numero: codigo,
        cuentaContableId: id,
      },
    });
    return id;
  }

  async function mkCotizacion(fecha: string, valor: number): Promise<void> {
    await db.prisma.cotizacion.create({
      data: { fecha: new Date(fecha), valor: valor.toFixed(6), fuente: "test" },
    });
  }

  async function mkAsiento(
    lineas: LineaSeed[],
    opts: { moneda?: "ARS" | "USD"; tipoCambio?: string; fecha?: Date } = {},
  ): Promise<void> {
    numeroSeq += 1;
    const totalDebe = lineas.reduce((s, l) => s + Number(l.debe ?? 0), 0);
    const totalHaber = lineas.reduce((s, l) => s + Number(l.haber ?? 0), 0);
    await db.prisma.asiento.create({
      data: {
        numero: numeroSeq,
        fecha: opts.fecha ?? FECHA,
        descripcion: `asiento ${numeroSeq}`,
        estado: "CONTABILIZADO",
        origen: "MANUAL",
        moneda: opts.moneda ?? "ARS",
        tipoCambio: opts.tipoCambio ?? "1",
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

  // Ancla consolidada: Σ saldo de cada cuenta (en su moneda nativa) convertido
  // a la moneda de presentación al TC de cierre. Es el objetivo de reconciliación.
  async function anclaConsolidada(
    cuentas: { id: number; moneda: "ARS" | "USD" }[],
    presentacion: "ARS" | "USD",
    tc: number,
  ): Promise<number> {
    const saldos = await calcularSaldosCuentasBancariasEnMonedaCuenta(
      cuentas.map((c) => ({ cuentaContableId: c.id, moneda: c.moneda })),
    );
    let total = 0;
    for (const c of cuentas) {
      const s = saldos.get(c.id)?.toNumber() ?? 0;
      total += convertirNum(s, c.moneda, presentacion, tc);
    }
    return total;
  }

  function ultimoSaldo(flujo: {
    meses: string[];
    totales: { saldoAcumuladoPorMes: Record<string, { toNumber: () => number }> };
  }): number {
    const ultimo = flujo.meses[flujo.meses.length - 1]!;
    return flujo.totales.saldoAcumuladoPorMes[ultimo]!.toNumber();
  }

  it("1) consolida USD: banco ARS (÷TC) + banco USD (nativo)", async () => {
    const bancoArs = await mkBanco("1.1.1.02.01", "BANCO NACION ARS", "ARS");
    const bancoUsd = await mkBanco("1.1.1.02.02", "BANCO USD", "USD");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE A", "ACTIVO");
    const proveedor = await mkCuenta("2.1.1.20", "PROVEEDOR EXTERIOR", "PASIVO");
    await mkCotizacion("2025-12-31", 1200);

    // Cobro 1.200.000 ARS al banco ARS.
    await mkAsiento([
      { cuentaId: bancoArs, debe: "1200000.00" },
      { cuentaId: cliente, haber: "1200000.00" },
    ]);
    // Pago 500 USD × TC 1000 desde el banco USD.
    await mkAsiento([
      {
        cuentaId: proveedor,
        debe: "500000.00",
        monedaOrigen: "USD",
        montoOrigen: "500.00",
        tipoCambioOrigen: "1000",
      },
      {
        cuentaId: bancoUsd,
        haber: "500000.00",
        monedaOrigen: "USD",
        montoOrigen: "500.00",
        tipoCambioOrigen: "1000",
      },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    // 1.200.000/1200 = 1000 USD ; banco USD = −500 USD → 500 USD.
    expect(ultimoSaldo(usd)).toBeCloseTo(500, 2);
    expect(ultimoSaldo(usd)).toBeCloseTo(
      await anclaConsolidada(
        [
          { id: bancoArs, moneda: "ARS" },
          { id: bancoUsd, moneda: "USD" },
        ],
        "USD",
        1200,
      ),
      2,
    );
    expect(usd.tipoCambioCierre?.toNumber()).toBe(1200);
  });

  it("2) consolida ARS: banco USD (×TC) + banco ARS (nativo)", async () => {
    const bancoArs = await mkBanco("1.1.1.02.01", "BANCO NACION ARS", "ARS");
    const bancoUsd = await mkBanco("1.1.1.02.02", "BANCO USD", "USD");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE A", "ACTIVO");
    const proveedor = await mkCuenta("2.1.1.20", "PROVEEDOR EXTERIOR", "PASIVO");
    await mkCotizacion("2025-12-31", 1200);

    await mkAsiento([
      { cuentaId: bancoArs, debe: "1200000.00" },
      { cuentaId: cliente, haber: "1200000.00" },
    ]);
    await mkAsiento([
      {
        cuentaId: proveedor,
        debe: "500000.00",
        monedaOrigen: "USD",
        montoOrigen: "500.00",
        tipoCambioOrigen: "1000",
      },
      {
        cuentaId: bancoUsd,
        haber: "500000.00",
        monedaOrigen: "USD",
        montoOrigen: "500.00",
        tipoCambioOrigen: "1000",
      },
    ]);

    const ars = await getFlujoCaja(DESDE, HASTA, "ARS");
    // banco ARS = 1.200.000 ; banco USD = −500 USD × 1200 = −600.000 → 600.000.
    expect(ultimoSaldo(ars)).toBeCloseTo(600000, 2);
    expect(ultimoSaldo(ars)).toBeCloseTo(
      await anclaConsolidada(
        [
          { id: bancoArs, moneda: "ARS" },
          { id: bancoUsd, moneda: "USD" },
        ],
        "ARS",
        1200,
      ),
      2,
    );
  });

  it("3) TC de cierre = última Cotizacion con fecha ≤ hasta", async () => {
    const bancoArs = await mkBanco("1.1.1.02.01", "BANCO NACION ARS", "ARS");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE A", "ACTIVO");
    await mkCotizacion("2025-06-30", 1000); // anterior
    await mkCotizacion("2025-12-31", 1200); // vigente al cierre (la que debe usar)
    await mkCotizacion("2026-06-30", 1500); // futura, posterior a `hasta` → ignorar

    await mkAsiento([
      { cuentaId: bancoArs, debe: "1200000.00" },
      { cuentaId: cliente, haber: "1200000.00" },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    // Debe usar 1200 (no 1000 ni 1500): 1.200.000/1200 = 1000.
    expect(usd.tipoCambioCierre?.toNumber()).toBe(1200);
    expect(ultimoSaldo(usd)).toBeCloseTo(1000, 2);
  });

  it("4) sin cotización: advertencia + cuenta en otra moneda queda fuera", async () => {
    const bancoArs = await mkBanco("1.1.1.02.01", "BANCO NACION ARS", "ARS");
    const bancoUsd = await mkBanco("1.1.1.02.02", "BANCO USD", "USD");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE A", "ACTIVO");
    const proveedor = await mkCuenta("2.1.1.20", "PROVEEDOR EXTERIOR", "PASIVO");
    // (sin mkCotizacion → no hay TC)

    await mkAsiento([
      { cuentaId: bancoArs, debe: "1200000.00" },
      { cuentaId: cliente, haber: "1200000.00" },
    ]);
    await mkAsiento([
      {
        cuentaId: proveedor,
        debe: "500000.00",
        monedaOrigen: "USD",
        montoOrigen: "500.00",
        tipoCambioOrigen: "1000",
      },
      {
        cuentaId: bancoUsd,
        haber: "500000.00",
        monedaOrigen: "USD",
        montoOrigen: "500.00",
        tipoCambioOrigen: "1000",
      },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    // Solo el banco USD (= moneda de presentación) cuenta; el ARS queda fuera.
    expect(usd.tipoCambioCierre).toBeNull();
    expect(ultimoSaldo(usd)).toBeCloseTo(-500, 2);
    expect(usd.advertencias.length).toBeGreaterThanOrEqual(1);
    expect(usd.advertencias.some((a) => /cotizaci/i.test(a))).toBe(true);
  });

  it("5) FC-2 sub-centavo: muchos movimientos chicos no pierden dinero", async () => {
    const bancoArs = await mkBanco("1.1.1.02.01", "BANCO NACION ARS", "ARS");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE A", "ACTIVO");
    await mkCotizacion("2025-12-31", 1000);

    // 20 cobros de 5 ARS c/u. Convertido: 5/1000 = 0,005 USD < 0,01 cada uno.
    // El corte sub-centavo viejo los descartaría (→ 0); deben sumar 0,10 USD.
    for (let i = 0; i < 20; i++) {
      await mkAsiento([
        { cuentaId: bancoArs, debe: "5.00" },
        { cuentaId: cliente, haber: "5.00" },
      ]);
    }

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    // 20 × 5 = 100 ARS / 1000 = 0,10 USD.
    expect(ultimoSaldo(usd)).toBeCloseTo(0.1, 2);
  });

  it("6) reconciliación consolidada con asientos mixtos (invariante clave)", async () => {
    const bancoArs = await mkBanco("1.1.1.02.01", "BANCO NACION ARS", "ARS");
    const bancoUsd = await mkBanco("1.1.1.02.02", "BANCO USD", "USD");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE A", "ACTIVO");
    const proveedorLocal = await mkCuenta("2.1.1.10", "PROVEEDOR LOCAL", "PASIVO");
    const proveedorExt = await mkCuenta("2.1.1.20", "PROVEEDOR EXTERIOR", "PASIVO");
    await mkCotizacion("2025-12-31", 1350);

    // Cobro y pago en ARS.
    await mkAsiento([
      { cuentaId: bancoArs, debe: "3000000.00" },
      { cuentaId: cliente, haber: "3000000.00" },
    ]);
    await mkAsiento([
      { cuentaId: proveedorLocal, debe: "750000.00" },
      { cuentaId: bancoArs, haber: "750000.00" },
    ]);
    // Cobro USD y pago USD.
    await mkAsiento([
      {
        cuentaId: bancoUsd,
        debe: "2700000.00",
        monedaOrigen: "USD",
        montoOrigen: "2000.00",
        tipoCambioOrigen: "1350",
      },
      {
        cuentaId: cliente,
        haber: "2700000.00",
        monedaOrigen: "USD",
        montoOrigen: "2000.00",
        tipoCambioOrigen: "1350",
      },
    ]);
    await mkAsiento([
      {
        cuentaId: proveedorExt,
        debe: "1300000.00",
        monedaOrigen: "USD",
        montoOrigen: "1000.00",
        tipoCambioOrigen: "1300",
      },
      {
        cuentaId: bancoUsd,
        haber: "1300000.00",
        monedaOrigen: "USD",
        montoOrigen: "1000.00",
        tipoCambioOrigen: "1300",
      },
    ]);

    const cuentas = [
      { id: bancoArs, moneda: "ARS" as const },
      { id: bancoUsd, moneda: "USD" as const },
    ];
    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    expect(ultimoSaldo(usd)).toBeCloseTo(await anclaConsolidada(cuentas, "USD", 1350), 2);

    const ars = await getFlujoCaja(DESDE, HASTA, "ARS");
    expect(ultimoSaldo(ars)).toBeCloseTo(await anclaConsolidada(cuentas, "ARS", 1350), 2);
  });

  it("7) asiento mixto (banco USD / contrapartida ARS): saldo por lado banco + advertencia", async () => {
    const bancoUsd = await mkBanco("1.1.1.02.02", "BANCO USD", "USD");
    const gasto = await mkCuenta("5.2.1.01", "COMISIONES", "EGRESO");
    await mkCotizacion("2025-12-31", 1200); // ≠ 1000 del booking → descuadre

    // Banco USD paga un gasto en concepto ARS puro (sin metadata USD).
    await mkAsiento([
      { cuentaId: gasto, debe: "200000.00" },
      {
        cuentaId: bancoUsd,
        haber: "200000.00",
        monedaOrigen: "USD",
        montoOrigen: "200.00",
        tipoCambioOrigen: "1000",
      },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    // Saldo por el LADO BANCO: −200 USD (montoOrigen). Reconcilia con la ancla.
    expect(ultimoSaldo(usd)).toBeCloseTo(-200, 2);
    expect(ultimoSaldo(usd)).toBeCloseTo(
      await anclaConsolidada([{ id: bancoUsd, moneda: "USD" }], "USD", 1200),
      2,
    );
    // El gasto ARS (÷1200 = −166,67) no cuadra con el banco (−200) → advertencia.
    expect(usd.advertencias.length).toBeGreaterThanOrEqual(1);
  });

  it("8) transferencia misma moneda: neta 0 en saldo, aparece en transferencias", async () => {
    const banco1 = await mkBanco("1.1.1.02.01", "BANCO NACION ARS", "ARS");
    const banco2 = await mkBanco("1.1.1.02.03", "BANCO GALICIA ARS", "ARS");
    await mkCotizacion("2025-12-31", 1200);

    await mkAsiento([
      { cuentaId: banco2, debe: "100000.00" },
      { cuentaId: banco1, haber: "100000.00" },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    expect(ultimoSaldo(usd)).toBeCloseTo(0, 2);
    expect(usd.transferencias.length).toBeGreaterThanOrEqual(1);
  });

  it("9) fallback legado USD (asiento.moneda=USD, debe/haber en USD crudo)", async () => {
    const bancoUsd = await mkBanco("1.1.1.02.02", "BANCO USD", "USD");
    const cliente = await mkCuenta("1.1.4.01", "CLIENTE USD", "ACTIVO");
    await mkCotizacion("2025-12-31", 1200);

    await mkAsiento(
      [
        { cuentaId: bancoUsd, debe: "200.00" },
        { cuentaId: cliente, haber: "200.00" },
      ],
      { moneda: "USD", tipoCambio: "950" },
    );

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    expect(ultimoSaldo(usd)).toBeCloseTo(200, 2);
    expect(ultimoSaldo(usd)).toBeCloseTo(
      await anclaConsolidada([{ id: bancoUsd, moneda: "USD" }], "USD", 1200),
      2,
    );
  });

  it("10) FC-2 rollup: subtotal sintético == suma de las analíticas", async () => {
    const bancoArs = await mkBanco("1.1.1.02.01", "BANCO NACION ARS", "ARS");
    await mkSintetica("5", "EGRESOS", "EGRESO", 1);
    await mkSintetica("5.2", "GASTOS", "EGRESO", 2, "5");
    await mkSintetica("5.2.1", "GASTOS GENERALES", "EGRESO", 3, "5.2");
    const g1 = await mkCuenta("5.2.1.01", "GASTO A", "EGRESO", "5.2.1");
    const g2 = await mkCuenta("5.2.1.02", "GASTO B", "EGRESO", "5.2.1");
    await mkCotizacion("2025-12-31", 1000);

    // Dos pagos con importes que generan centavos al dividir por 1000.
    await mkAsiento([
      { cuentaId: g1, debe: "123456.00" },
      { cuentaId: bancoArs, haber: "123456.00" },
    ]);
    await mkAsiento([
      { cuentaId: g2, debe: "654321.00" },
      { cuentaId: bancoArs, haber: "654321.00" },
    ]);

    const usd = await getFlujoCaja(DESDE, HASTA, "USD");
    const sintetica = findNode(usd.contrapartidas, "5.2.1");
    expect(sintetica).not.toBeNull();
    const hijos = sintetica!.children;
    const sumaHijos = hijos.reduce((acc, c) => acc + c.totalPeriodo.toNumber(), 0);
    expect(sintetica!.totalPeriodo.toNumber()).toBeCloseTo(sumaHijos, 2);
    // Y por mes: cada celda del sintético == suma de las celdas de los hijos.
    for (const m of usd.meses) {
      const padre = sintetica!.valoresPorMes[m]?.monto.toNumber() ?? 0;
      const suma = hijos.reduce((acc, c) => acc + (c.valoresPorMes[m]?.monto.toNumber() ?? 0), 0);
      expect(padre).toBeCloseTo(suma, 2);
    }
  });
});
