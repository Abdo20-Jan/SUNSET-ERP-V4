import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Rollout USD — el KPI gemelo "Saldo Bancos + Caja" de la pestaña Resumen del BI
// (`getResumenEjecutivo.saldoBancosCaja`) debe reconciliarse con el card del
// dashboard (`getSaldosBancarios`), igual que ya lo hace el KPI del dashboard
// (#261). Antes el KPI del BI sumaba ARS crudo del ledger sobre 1.1.1.* (sin
// filtrar activa) → divergía del card por:
//   (1) moneda: USD al TC histórico ÷ TC ≠ saldo USD nativo,
//   (2) incluía 1.1.1.03.* (cheques a depositar) y cuentas inactivas.
// Ahora deriva de la MISMA fuente del card y expone {ars, usd} nativo.

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

import { Moneda } from "@/generated/prisma/client";
import { getResumenEjecutivo } from "@/lib/services/bi";
import { getSaldosBancarios } from "@/lib/services/dashboard";

let testDb: TestDb;
let prisma: PrismaClient;

const TABLES = [
  "LineaAsiento",
  "Asiento",
  "CuentaBancaria",
  "CuentaContable",
  "PeriodoContable",
] as const;

const FECHA = new Date("2025-06-15T12:00:00.000Z");
const DESDE = new Date("2025-06-01T00:00:00.000Z");
const HASTA = new Date("2025-06-30T23:59:59.999Z");

beforeAll(async () => {
  testDb = await createTestDb();
  prisma = testDb.prisma;
  h.setClient(prisma);
}, 120_000);

afterAll(async () => {
  await testDb?.stop();
});

let periodoId: number;
let contrapartidaId: number;
let numeroSeq = 0;

async function mkCuenta(opts: {
  codigo: string;
  nombre: string;
  categoria: "ACTIVO" | "PASIVO";
  activa?: boolean;
}): Promise<number> {
  const c = await prisma.cuentaContable.create({
    data: {
      codigo: opts.codigo,
      nombre: opts.nombre,
      tipo: "ANALITICA",
      categoria: opts.categoria,
      nivel: opts.codigo.split(".").length,
      activa: opts.activa ?? true,
    },
  });
  return c.id;
}

type LineaSeed = {
  cuentaId: number;
  debe?: string;
  haber?: string;
  monedaOrigen?: Moneda;
  montoOrigen?: string;
  tipoCambioOrigen?: string;
};

/** Crea un asiento CONTABILIZADO balanceado (totalDebe == totalHaber). */
async function mkAsiento(lineas: LineaSeed[], moneda: Moneda = Moneda.ARS): Promise<void> {
  numeroSeq += 1;
  const totalDebe = lineas.reduce((s, l) => s + Number(l.debe ?? 0), 0);
  const totalHaber = lineas.reduce((s, l) => s + Number(l.haber ?? 0), 0);
  await prisma.asiento.create({
    data: {
      numero: numeroSeq,
      fecha: FECHA,
      descripcion: `Asiento ${numeroSeq}`,
      estado: "CONTABILIZADO",
      origen: "MANUAL",
      moneda,
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

beforeEach(async () => {
  await testDb.reset(TABLES);
  numeroSeq = 0;
  const periodo = await prisma.periodoContable.create({
    data: {
      codigo: "2025-06",
      nombre: "Junio 2025",
      fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
      fechaFin: new Date("2025-06-30T23:59:59.000Z"),
      estado: "ABIERTO",
    },
  });
  periodoId = periodo.id;
  // Contrapartida fuera de Bancos/Caja (PASIVO) para balancear los asientos.
  contrapartidaId = await mkCuenta({
    codigo: "2.1.1.01",
    nombre: "CONTRAPARTIDA",
    categoria: "PASIVO",
  });
});

describe("getResumenEjecutivo — saldoBancosCaja native-aware (BI)", () => {
  it("expone {ars, usd} nativo y reconcilia con el card (getSaldosBancarios)", async () => {
    // Caja ARS (1.1.1.01.*): debe 500.000 ARS → saldo 500.000 ARS.
    const cajaId = await mkCuenta({
      codigo: "1.1.1.01.01",
      nombre: "CAJA GENERAL — ARS",
      categoria: "ACTIVO",
    });
    await mkAsiento([
      { cuentaId: cajaId, debe: "500000.00" },
      { cuentaId: contrapartidaId, haber: "500000.00" },
    ]);

    // Banco USD (1.1.1.02.*) con CuentaBancaria{USD}: depósito 10.000 USD @1000
    // y retiro 3.000 USD @1200 → saldo USD nativo = 7.000 (invariante al TC).
    const bancoUsdId = await mkCuenta({
      codigo: "1.1.1.02.10",
      nombre: "BANCO NACIÓN — USD",
      categoria: "ACTIVO",
    });
    await prisma.cuentaBancaria.create({
      data: {
        banco: "Banco Nación",
        tipo: "CUENTA_CORRIENTE",
        moneda: Moneda.USD,
        numero: "0001-0010",
        cuentaContableId: bancoUsdId,
      },
    });
    await mkAsiento(
      [
        {
          cuentaId: bancoUsdId,
          debe: "10000000.00",
          monedaOrigen: Moneda.USD,
          montoOrigen: "10000.00",
          tipoCambioOrigen: "1000.000000",
        },
        { cuentaId: contrapartidaId, haber: "10000000.00" },
      ],
      Moneda.USD,
    );
    await mkAsiento(
      [
        { cuentaId: contrapartidaId, debe: "3600000.00" },
        {
          cuentaId: bancoUsdId,
          haber: "3600000.00",
          monedaOrigen: Moneda.USD,
          montoOrigen: "3000.00",
          tipoCambioOrigen: "1200.000000",
        },
      ],
      Moneda.USD,
    );

    // Cheques a depositar (1.1.1.03.*) — el KPI viejo (1.1.1.*) los incluía,
    // el card NO (sólo 1.1.1.01/02). Guard de regresión: deben quedar FUERA.
    const chequesId = await mkCuenta({
      codigo: "1.1.1.03.01",
      nombre: "VALORES A DEPOSITAR",
      categoria: "ACTIVO",
    });
    await mkAsiento([
      { cuentaId: chequesId, debe: "4444444.00" },
      { cuentaId: contrapartidaId, haber: "4444444.00" },
    ]);

    // Inversión financiera (1.1.2.*) — NO es Bancos/Caja: debe ser EXCLUIDA.
    const inversionId = await mkCuenta({
      codigo: "1.1.2.01",
      nombre: "FONDOS COMUNES DE INVERSIÓN",
      categoria: "ACTIVO",
    });
    await mkAsiento([
      { cuentaId: inversionId, debe: "9999999.00" },
      { cuentaId: contrapartidaId, haber: "9999999.00" },
    ]);

    // Banco INACTIVO (1.1.1.02.*, activa=false): debe ser EXCLUIDO.
    const bancoInactivoId = await mkCuenta({
      codigo: "1.1.1.02.99",
      nombre: "BANCO CERRADO — ARS",
      categoria: "ACTIVO",
      activa: false,
    });
    await mkAsiento([
      { cuentaId: bancoInactivoId, debe: "7777777.00" },
      { cuentaId: contrapartidaId, haber: "7777777.00" },
    ]);

    const r = await getResumenEjecutivo({ desde: DESDE, hasta: HASTA });

    // KPI native-aware: ARS y USD por separado, USD invariante al TC.
    // Caja 500.000 ARS; cheques/inversión/inactiva quedan FUERA del ARS.
    expect(r.kpis.saldoBancosCaja.ars.toFixed(2)).toBe("500000.00");
    expect(r.kpis.saldoBancosCaja.usd.toFixed(2)).toBe("7000.00");

    // El card sólo trae caja (ARS) + banco USD (activos, 1.1.1.01/02).
    const saldos = await getSaldosBancarios();
    expect(saldos.map((s) => s.codigo).sort()).toEqual(["1.1.1.01.01", "1.1.1.02.10"]);

    // Reconciliación KPI ↔ card: agregando el card por moneda nativa.
    const cardArs = saldos
      .filter((s) => s.moneda === Moneda.ARS)
      .reduce((acc, s) => acc + Number(s.saldo), 0);
    const cardUsd = saldos
      .filter((s) => s.moneda === Moneda.USD)
      .reduce((acc, s) => acc + Number(s.saldo), 0);
    expect(r.kpis.saldoBancosCaja.ars.toFixed(2)).toBe(cardArs.toFixed(2));
    expect(r.kpis.saldoBancosCaja.usd.toFixed(2)).toBe(cardUsd.toFixed(2));
  });

  it("sin cuentas de banco/caja: {ars:0, usd:0}", async () => {
    const r = await getResumenEjecutivo({ desde: DESDE, hasta: HASTA });
    expect(r.kpis.saldoBancosCaja.ars.toFixed(2)).toBe("0.00");
    expect(r.kpis.saldoBancosCaja.usd.toFixed(2)).toBe("0.00");
  });
});
