import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Cierre del Balance con cuentas de resultado cuya naturaleza es OPUESTA a su
// categoría (etapa 2). El resultado del ejercicio que se suma al PN debe ser
// Σ(haber − debe) de todas las cuentas de resultado (la cascada), no
// `totalIngresos − totalEgresos` (que invierte el signo de las deducciones
// 4.2 DEUDOR y de las ganancias financieras 9.x ACREEDOR). Sólo así A = P + PN.

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

import type { Naturaleza } from "@/generated/prisma/client";
import { getBalanceGeneralByFecha } from "@/lib/services/reportes/balance-general";
import { getEstadoResultadosByFecha } from "@/lib/services/reportes/estado-resultados";

const DESDE = new Date("2025-01-01T00:00:00.000Z");
const HASTA = new Date("2025-12-31T23:59:59.999Z");
const FECHA = new Date("2025-06-10T12:00:00.000Z");

type Cat = "ACTIVO" | "PASIVO" | "PATRIMONIO" | "EGRESO" | "INGRESO";

describe("Balance: cierre A = P + PN con cuentas de resultado de naturaleza opuesta", () => {
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
        categoria,
        naturaleza,
        nivel: 4,
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
          })),
        },
      },
    });
  }

  it("cierra con ganancia financiera (9.x ACREEDOR) y deducción (4.2 DEUDOR)", async () => {
    const caja = await mkCuenta("1.1.1.01", "CAJA", "ACTIVO", "DEUDOR");
    const capital = await mkCuenta("3.1.01", "CAPITAL SOCIAL", "PATRIMONIO", "ACREEDOR");
    const ventas = await mkCuenta("4.1.01", "VENTAS MERCADO INTERNO", "INGRESO", "ACREEDOR");
    const deduccion = await mkCuenta("4.2.01", "DEVOLUCIONES SOBRE VENTAS", "INGRESO", "DEUDOR");
    const interes = await mkCuenta("9.1.01", "INTERESES GANADOS", "EGRESO", "ACREEDOR");
    const gasto = await mkCuenta("7.1.01", "SUELDOS ADMINISTRACIÓN", "EGRESO", "DEUDOR");

    // Aporte inicial: Caja 5000 / Capital 5000.
    await mkAsiento([
      { cuentaId: caja, debe: "5000.00" },
      { cuentaId: capital, haber: "5000.00" },
    ]);
    // Venta: Caja 1000 / Ventas 1000  → +1000
    await mkAsiento([
      { cuentaId: caja, debe: "1000.00" },
      { cuentaId: ventas, haber: "1000.00" },
    ]);
    // Devolución (deducción DEUDOR): Deducción 100 / Caja 100  → −100
    await mkAsiento([
      { cuentaId: deduccion, debe: "100.00" },
      { cuentaId: caja, haber: "100.00" },
    ]);
    // Interés ganado (resultado ACREEDOR en clase 9): Caja 200 / Interés 200  → +200
    await mkAsiento([
      { cuentaId: caja, debe: "200.00" },
      { cuentaId: interes, haber: "200.00" },
    ]);
    // Gasto: Gasto 50 / Caja 50  → −50
    await mkAsiento([
      { cuentaId: gasto, debe: "50.00" },
      { cuentaId: caja, haber: "50.00" },
    ]);

    // Resultado correcto = 1000 − 100 + 200 − 50 = 1050.
    const er = await getEstadoResultadosByFecha({ fechaDesde: DESDE, fechaHasta: HASTA });
    expect(er.resultado.toFixed(2)).toBe("1050.00");
    // El resultado expuesto es el de la cascada (no totalIngresos − totalEgresos,
    // que daría 1100 − 250 = 850 e invertiría el signo de deducción/ganancia).
    expect(er.resultado.toFixed(2)).toBe(er.rt9.resultadoEjercicio.toFixed(2));
    expect(er.totalIngresos.minus(er.totalEgresos).toFixed(2)).toBe("850.00");

    // Balance: Caja = 5000 + 1000 − 100 + 200 − 50 = 6050; Capital 5000; Resultado 1050.
    const bal = await getBalanceGeneralByFecha({ fechaDesde: DESDE, fechaHasta: HASTA });
    expect(bal.totalActivo.toFixed(2)).toBe("6050.00");
    expect(bal.resultadoEjercicio.toFixed(2)).toBe("1050.00");
    expect(bal.totalPatrimonioAjustado.toFixed(2)).toBe("6050.00");
    expect(bal.cuadra).toBe(true);
    expect(bal.diferencia.toFixed(2)).toBe("0.00");
  });
});
