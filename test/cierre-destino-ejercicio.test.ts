import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Naturaleza, PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Cierre de resultados (clases 4-9 → 3.4.01) y destino del resultado
// (3.4.01 → 3.3.01) — FLUJOS CONTABLES, etapa 3. El cierre salda TODAS las
// cuentas de resultado contra 3.4.01 (ganancia → HABER 3.4.01, pérdida → DEBE)
// y el destino transfiere el saldo a Resultados no asignados.

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

import type { CuentaCategoria } from "@/generated/prisma/client";
import {
  AsientoError,
  crearAsientoCierre,
  crearAsientoDestinoResultado,
} from "@/lib/services/asiento-automatico";

const DESDE = new Date("2025-01-01T00:00:00.000Z");
const HASTA = new Date("2025-12-31T00:00:00.000Z");
const FECHA_MOV = new Date("2025-06-10T12:00:00.000Z");

type Cat = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "EGRESO" | "INGRESO";

describe("Cierre y destino del resultado (FLUJOS CONTABLES)", () => {
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
        fechaInicio: DESDE,
        fechaFin: HASTA,
        estado: "ABIERTO",
      },
    });
    periodoId = periodo.id;
    numeroSeq = 0;
  });

  async function mkCuenta(
    codigo: string,
    nombre: string,
    categoria: Cat,
    naturaleza: Naturaleza,
  ): Promise<number> {
    const c = await db.prisma.cuentaContable.create({
      data: {
        codigo,
        nombre,
        tipo: "ANALITICA",
        categoria: categoria as CuentaCategoria,
        naturaleza,
        nivel: codigo.split(".").length,
        padreCodigo: null,
      },
    });
    return c.id;
  }

  async function mkAsiento(lineas: { cuentaId: number; debe?: string; haber?: string }[]) {
    numeroSeq += 1;
    const totalDebe = lineas.reduce((s, l) => s + Number(l.debe ?? 0), 0);
    const totalHaber = lineas.reduce((s, l) => s + Number(l.haber ?? 0), 0);
    await db.prisma.asiento.create({
      data: {
        numero: numeroSeq,
        fecha: FECHA_MOV,
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
          })),
        },
      },
    });
  }

  // Saldo Σ(haber − debe) de una cuenta sobre asientos CONTABILIZADOS.
  async function saldo(codigo: string): Promise<number> {
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { cuenta: { codigo }, asiento: { estado: "CONTABILIZADO" } },
      select: { debe: true, haber: true },
    });
    return lineas.reduce((acc, l) => acc + (Number(l.haber) - Number(l.debe)), 0);
  }

  it("cierra una ganancia: saldan clases 4-9 y 3.4.01 recibe el resultado (HABER)", async () => {
    const caja = await mkCuenta("1.1.1.01.01", "CAJA", "ACTIVO", "DEUDOR");
    const capital = await mkCuenta("3.1.01", "CAPITAL", "PATRIMONIO", "ACREEDOR");
    const ventas = await mkCuenta("4.1.01.01", "VENTAS", "INGRESO", "ACREEDOR");
    const gasto = await mkCuenta("7.1.01", "SUELDOS", "EGRESO", "DEUDOR");

    await mkAsiento([
      { cuentaId: caja, debe: "5000.00" },
      { cuentaId: capital, haber: "5000.00" },
    ]);
    await mkAsiento([
      { cuentaId: caja, debe: "1000.00" },
      { cuentaId: ventas, haber: "1000.00" },
    ]);
    await mkAsiento([
      { cuentaId: gasto, debe: "300.00" },
      { cuentaId: caja, haber: "300.00" },
    ]);

    const asiento = await crearAsientoCierre({ fechaDesde: DESDE, fechaHasta: HASTA }, db.prisma);

    // El asiento de cierre está CONTABILIZADO y cuadra.
    expect(asiento.estado).toBe("CONTABILIZADO");
    expect(asiento.totalDebe.toFixed(2)).toBe(asiento.totalHaber.toFixed(2));

    // Las cuentas de resultado quedan en CERO tras el cierre.
    expect(await saldo("4.1.01.01")).toBeCloseTo(0, 2);
    expect(await saldo("7.1.01")).toBeCloseTo(0, 2);

    // 3.4.01 recibe la ganancia 1000 − 300 = 700 (saldo acreedor).
    expect(await saldo("3.4.01")).toBeCloseTo(700, 2);
  });

  it("cierra una pérdida: 3.4.01 queda deudor (saldo negativo)", async () => {
    const caja = await mkCuenta("1.1.1.01.01", "CAJA", "ACTIVO", "DEUDOR");
    const capital = await mkCuenta("3.1.01", "CAPITAL", "PATRIMONIO", "ACREEDOR");
    const ventas = await mkCuenta("4.1.01.01", "VENTAS", "INGRESO", "ACREEDOR");
    const gasto = await mkCuenta("7.1.01", "SUELDOS", "EGRESO", "DEUDOR");

    await mkAsiento([
      { cuentaId: caja, debe: "5000.00" },
      { cuentaId: capital, haber: "5000.00" },
    ]);
    await mkAsiento([
      { cuentaId: caja, debe: "200.00" },
      { cuentaId: ventas, haber: "200.00" },
    ]);
    await mkAsiento([
      { cuentaId: gasto, debe: "900.00" },
      { cuentaId: caja, haber: "900.00" },
    ]);

    await crearAsientoCierre({ fechaDesde: DESDE, fechaHasta: HASTA }, db.prisma);

    expect(await saldo("4.1.01.01")).toBeCloseTo(0, 2);
    expect(await saldo("7.1.01")).toBeCloseTo(0, 2);
    // Pérdida 200 − 900 = −700 → 3.4.01 saldo deudor.
    expect(await saldo("3.4.01")).toBeCloseTo(-700, 2);
  });

  it("el destino transfiere 3.4.01 → 3.3.01 (deja el resultado en cero)", async () => {
    const caja = await mkCuenta("1.1.1.01.01", "CAJA", "ACTIVO", "DEUDOR");
    const capital = await mkCuenta("3.1.01", "CAPITAL", "PATRIMONIO", "ACREEDOR");
    const ventas = await mkCuenta("4.1.01.01", "VENTAS", "INGRESO", "ACREEDOR");

    await mkAsiento([
      { cuentaId: caja, debe: "5000.00" },
      { cuentaId: capital, haber: "5000.00" },
    ]);
    await mkAsiento([
      { cuentaId: caja, debe: "700.00" },
      { cuentaId: ventas, haber: "700.00" },
    ]);

    await crearAsientoCierre({ fechaDesde: DESDE, fechaHasta: HASTA }, db.prisma);
    expect(await saldo("3.4.01")).toBeCloseTo(700, 2);

    const destino = await crearAsientoDestinoResultado({ fecha: HASTA }, db.prisma);
    expect(destino.estado).toBe("CONTABILIZADO");

    // 3.4.01 vuelve a cero; 3.3.01 (resultados no asignados) recibe la ganancia.
    expect(await saldo("3.4.01")).toBeCloseTo(0, 2);
    expect(await saldo("3.3.01")).toBeCloseTo(700, 2);
  });

  it("es idempotente: un segundo cierre en el mismo rango falla", async () => {
    const caja = await mkCuenta("1.1.1.01.01", "CAJA", "ACTIVO", "DEUDOR");
    const ventas = await mkCuenta("4.1.01.01", "VENTAS", "INGRESO", "ACREEDOR");
    await mkAsiento([
      { cuentaId: caja, debe: "500.00" },
      { cuentaId: ventas, haber: "500.00" },
    ]);

    await crearAsientoCierre({ fechaDesde: DESDE, fechaHasta: HASTA }, db.prisma);
    await expect(
      crearAsientoCierre({ fechaDesde: DESDE, fechaHasta: HASTA }, db.prisma),
    ).rejects.toBeInstanceOf(AsientoError);
  });

  it("sin resultados en el rango, el cierre falla (nada que cerrar)", async () => {
    await mkCuenta("1.1.1.01.01", "CAJA", "ACTIVO", "DEUDOR");
    await expect(
      crearAsientoCierre({ fechaDesde: DESDE, fechaHasta: HASTA }, db.prisma),
    ).rejects.toBeInstanceOf(AsientoError);
  });
});
