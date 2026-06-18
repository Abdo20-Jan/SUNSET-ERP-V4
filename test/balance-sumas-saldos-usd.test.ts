import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Balancete (Sumas y Saldos) — columnas USD. El balancete es trial balance
// PRE-cierre (sin revaluación): para una posición USD-nata muestra su USD
// nativo (montoOrigen, invariante al TC); para una línea ARS-nata convierte
// ARS÷TC de cierre. Casos cubiertos:
//   1) USD-nato NO infla el saldo USD: montoOrigen pertenece SÓLO al lado con
//      valuación ARS (debe XOR haber), no a ambos.
//   2) saldo USD neto de una posición con movimientos en ambos lados.
//   3) saldo inicial (vía groupBy) en USD para asientos previos a fechaDesde.
//   4) cuenta ARS-nata: ARS÷TC.
//   5) sin TC: USD-natos conocidos (montoOrigen); ARS-natos null.
//   6) prune preserva cuentas con saldo SÓLO en USD.

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

import {
  type BalanceNode,
  getBalanceSumasYSaldos,
  pruneBalanceSinSaldo,
} from "@/lib/services/balance-sumas-saldos";

type Cat = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "INGRESO" | "EGRESO";
type Nat = "DEUDOR" | "ACREEDOR";

const MAYO = new Date("2025-05-15T12:00:00.000Z");
const JUNIO = new Date("2025-06-15T12:00:00.000Z");
const DESDE_JUNIO = new Date("2025-06-01T00:00:00.000Z");
const HASTA_JUNIO = new Date("2025-06-30T23:59:59.999Z");

function findNode(roots: BalanceNode[], codigo: string): BalanceNode | undefined {
  for (const n of roots) {
    if (n.codigo === codigo) return n;
    if (n.children) {
      const hit = findNode(n.children, codigo);
      if (hit) return hit;
    }
  }
  return undefined;
}

type LineaSeed = {
  cuentaId: number;
  debe?: string;
  haber?: string;
  monedaOrigen?: "USD";
  montoOrigen?: string;
};

describe("getBalanceSumasYSaldos — columnas USD (USD-nato por lado, groupBy, prune)", () => {
  let db: TestDb;
  let periodoId: number;
  let numeroSeq = 0;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    numeroSeq = 0;
    await db.reset(["LineaAsiento", "Asiento", "CuentaContable", "PeriodoContable"]);
    const periodo = await db.prisma.periodoContable.create({
      data: {
        codigo: "2025",
        nombre: "Ejercicio 2025",
        fechaInicio: new Date("2025-01-01T00:00:00.000Z"),
        fechaFin: new Date("2025-12-31T23:59:59.999Z"),
      },
    });
    periodoId = periodo.id;
  });

  async function mkCuenta(
    codigo: string,
    nombre: string,
    categoria: Cat,
    naturaleza: Nat,
  ): Promise<number> {
    const c = await db.prisma.cuentaContable.create({
      data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4, naturaleza },
    });
    return c.id;
  }

  async function mkAsiento(fecha: Date, lineas: LineaSeed[]): Promise<void> {
    numeroSeq += 1;
    const totalDebe = lineas.reduce((s, l) => s + Number(l.debe ?? 0), 0);
    const totalHaber = lineas.reduce((s, l) => s + Number(l.haber ?? 0), 0);
    await db.prisma.asiento.create({
      data: {
        numero: numeroSeq,
        fecha,
        descripcion: `asiento ${numeroSeq}`,
        estado: "CONTABILIZADO",
        origen: "MANUAL",
        periodoId,
        totalDebe: totalDebe.toFixed(2),
        totalHaber: totalHaber.toFixed(2),
        lineas: {
          create: lineas.map((l) => ({
            cuentaId: l.cuentaId,
            debe: l.debe ?? "0.00",
            haber: l.haber ?? "0.00",
            ...(l.monedaOrigen ? { monedaOrigen: l.monedaOrigen } : {}),
            ...(l.montoOrigen ? { montoOrigen: l.montoOrigen } : {}),
          })),
        },
      },
    });
  }

  it("préstamo USD-nato: montoOrigen sólo en el lado haber (no infla el saldo USD)", async () => {
    const banco = await mkCuenta("1.1.1.01", "Banco USD", "ACTIVO", "DEUDOR");
    const prestamo = await mkCuenta("2.1.5.01", "Préstamo USD", "PASIVO", "ACREEDOR");
    // Ingreso de préstamo: banco debe / préstamo haber, USD 1000 @ TC 1200.
    await mkAsiento(JUNIO, [
      { cuentaId: banco, debe: "1200000.00", monedaOrigen: "USD", montoOrigen: "1000.00" },
      { cuentaId: prestamo, haber: "1200000.00", monedaOrigen: "USD", montoOrigen: "1000.00" },
    ]);

    const { root } = await getBalanceSumasYSaldos({ tcParaUsd: "1200" });

    const p = findNode(root, "2.1.5.01");
    expect(p?.debeUsd).toBe("0.00");
    expect(p?.haberUsd).toBe("1000.00");
    expect(p?.saldoFinalUsd).toBe("1000.00");
    expect(p?.saldoFinal).toBe("1200000.00");

    const b = findNode(root, "1.1.1.01");
    expect(b?.debeUsd).toBe("1000.00");
    expect(b?.haberUsd).toBe("0.00");
    expect(b?.saldoFinalUsd).toBe("1000.00");
  });

  it("posición USD-nata mixta (compra 1000 + pago parcial 400): saldoFinalUsd neto = 600", async () => {
    const estoque = await mkCuenta("1.1.7.02", "Estoque importación", "ACTIVO", "DEUDOR");
    const banco = await mkCuenta("1.1.1.01", "Banco", "ACTIVO", "DEUDOR");
    const prov = await mkCuenta("2.1.1.05", "Proveedor exterior", "PASIVO", "ACREEDOR");
    // Compra: estoque debe / proveedor haber, USD 1000 @ 1200.
    await mkAsiento(JUNIO, [
      { cuentaId: estoque, debe: "1200000.00", monedaOrigen: "USD", montoOrigen: "1000.00" },
      { cuentaId: prov, haber: "1200000.00", monedaOrigen: "USD", montoOrigen: "1000.00" },
    ]);
    // Pago parcial: proveedor debe / banco haber, USD 400 @ 1300.
    await mkAsiento(JUNIO, [
      { cuentaId: prov, debe: "520000.00", monedaOrigen: "USD", montoOrigen: "400.00" },
      { cuentaId: banco, haber: "520000.00", monedaOrigen: "USD", montoOrigen: "400.00" },
    ]);

    const { root } = await getBalanceSumasYSaldos({ tcParaUsd: "1300" });

    const p = findNode(root, "2.1.1.05");
    expect(p?.debeUsd).toBe("400.00");
    expect(p?.haberUsd).toBe("1000.00");
    expect(p?.saldoFinalUsd).toBe("600.00");
  });

  it("saldo inicial USD (groupBy): asiento anterior a fechaDesde aporta al saldo inicial", async () => {
    const banco = await mkCuenta("1.1.1.01", "Banco USD", "ACTIVO", "DEUDOR");
    const prestamo = await mkCuenta("2.1.5.01", "Préstamo USD", "PASIVO", "ACREEDOR");
    // Asiento en MAYO (previo a junio): queda en el saldo inicial.
    await mkAsiento(MAYO, [
      { cuentaId: banco, debe: "1200000.00", monedaOrigen: "USD", montoOrigen: "1000.00" },
      { cuentaId: prestamo, haber: "1200000.00", monedaOrigen: "USD", montoOrigen: "1000.00" },
    ]);

    const { root } = await getBalanceSumasYSaldos({
      fechaDesde: DESDE_JUNIO,
      fechaHasta: HASTA_JUNIO,
      tcParaUsd: "1250",
    });

    const p = findNode(root, "2.1.5.01");
    // USD-nato: usa montoOrigen (1000), NO ÷TC (no daría 1200000/1250).
    expect(p?.saldoInicial).toBe("1200000.00");
    expect(p?.saldoInicialUsd).toBe("1000.00");
    expect(p?.debe).toBe("0.00");
    expect(p?.haber).toBe("0.00");
    expect(p?.saldoFinal).toBe("1200000.00");
    expect(p?.saldoFinalUsd).toBe("1000.00");
  });

  it("cuenta ARS-nata: USD = ARS ÷ TC de cierre", async () => {
    const caja = await mkCuenta("1.1.1.02", "Caja ARS", "ACTIVO", "DEUDOR");
    const ventas = await mkCuenta("4.1.1.01", "Ventas", "INGRESO", "ACREEDOR");
    // ARS-natas (sin monedaOrigen/montoOrigen).
    await mkAsiento(JUNIO, [
      { cuentaId: caja, debe: "130000.00" },
      { cuentaId: ventas, haber: "130000.00" },
    ]);

    const { root } = await getBalanceSumasYSaldos({ tcParaUsd: "1300" });

    const c = findNode(root, "1.1.1.02");
    expect(c?.saldoFinal).toBe("130000.00");
    expect(c?.saldoFinalUsd).toBe("100.00"); // 130000 / 1300
  });

  it("sin TC: USD-nato conocido (montoOrigen); ARS-nato sin USD (null)", async () => {
    const banco = await mkCuenta("1.1.1.01", "Banco USD", "ACTIVO", "DEUDOR");
    const prestamo = await mkCuenta("2.1.5.01", "Préstamo USD", "PASIVO", "ACREEDOR");
    const caja = await mkCuenta("1.1.1.02", "Caja ARS", "ACTIVO", "DEUDOR");
    const ventas = await mkCuenta("4.1.1.01", "Ventas", "INGRESO", "ACREEDOR");
    await mkAsiento(JUNIO, [
      { cuentaId: banco, debe: "1200000.00", monedaOrigen: "USD", montoOrigen: "1000.00" },
      { cuentaId: prestamo, haber: "1200000.00", monedaOrigen: "USD", montoOrigen: "1000.00" },
    ]);
    await mkAsiento(JUNIO, [
      { cuentaId: caja, debe: "130000.00" },
      { cuentaId: ventas, haber: "130000.00" },
    ]);

    const { root } = await getBalanceSumasYSaldos({}); // sin tcParaUsd

    // Posición 100% USD: saldo USD conocido sin depender del TC.
    expect(findNode(root, "2.1.5.01")?.saldoFinalUsd).toBe("1000.00");
    // ARS-nata sin TC: no se puede expresar en USD.
    expect(findNode(root, "1.1.1.02")?.saldoFinalUsd).toBeNull();
  });

  it("pruneBalanceSinSaldo preserva cuenta con saldo SÓLO en USD y poda las totalmente vacías", () => {
    const mk = (codigo: string, over: Partial<BalanceNode>): BalanceNode => ({
      kind: "cuenta",
      id: 1,
      codigo,
      nombre: codigo,
      tipo: "ANALITICA",
      categoria: "ACTIVO",
      nivel: 4,
      saldoInicial: "0.00",
      debe: "0.00",
      haber: "0.00",
      saldoFinal: "0.00",
      saldoInicialUsd: "0.00",
      debeUsd: "0.00",
      haberUsd: "0.00",
      saldoFinalUsd: "0.00",
      ...over,
    });

    const soloUsd = mk("1.1.1.01", { saldoInicialUsd: "200.00", saldoFinalUsd: "200.00" });
    const vacia = mk("1.1.1.02", {});
    const usdNull = mk("1.1.1.03", {
      saldoInicialUsd: null,
      debeUsd: null,
      haberUsd: null,
      saldoFinalUsd: null,
    });
    const conArs = mk("1.1.1.04", { saldoFinal: "500.00" });

    const out = pruneBalanceSinSaldo([soloUsd, vacia, usdNull, conArs]);
    const codigos = out.map((n) => n.codigo).sort();
    expect(codigos).toEqual(["1.1.1.01", "1.1.1.04"]); // sólo-USD y con-ARS sobreviven
  });
});
