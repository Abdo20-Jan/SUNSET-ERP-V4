import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Rollout USD del dashboard — `getPrestamosActivos` debe exponer el saldo USD
// nativo (invariante a TC, derivado de montoOrigen vía E4d) para que la
// PrestamosActivosCard pueda presentar el saldo en USD en vez de sólo el
// "Equiv. ARS @ TC de alta". Antes usaba `calcularSaldosPrestamos` (sólo ARS).

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

import { Moneda, PrestamoClasificacion } from "@/generated/prisma/client";
import { contabilizarAsiento, crearAsientoPrestamo } from "@/lib/services/asiento-automatico";
import { crearMovimientoTesoreriaAction } from "@/lib/actions/movimientos-tesoreria";
import { getPrestamosActivos } from "@/lib/services/dashboard";

let testDb: TestDb;
let prisma: PrismaClient;

const TABLES = [
  "LineaAsiento",
  "Asiento",
  "MovimientoTesoreria",
  "PrestamoExterno",
  "CuentaBancaria",
  "CuentaContable",
  "PeriodoContable",
] as const;

const FECHA = new Date("2025-06-15T12:00:00.000Z");

beforeAll(async () => {
  testDb = await createTestDb();
  prisma = testDb.prisma;
  h.setClient(prisma);
}, 120_000);

afterAll(async () => {
  await testDb?.stop();
});

let periodoId: number;

beforeEach(async () => {
  await testDb.reset(TABLES);
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
  // Sintéticas padre (clase 9 ULTRA) para auto-create de la diferencia cambiaria
  // al amortizar a TC distinto del de alta.
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
});

let cuentaSeq = 0;
async function mkCuenta(nombre: string, categoria: "ACTIVO" | "PASIVO"): Promise<number> {
  cuentaSeq += 1;
  const codigo = `7.7.7.${String(cuentaSeq).padStart(2, "0")}`;
  const c = await prisma.cuentaContable.create({
    data: { codigo, nombre, tipo: "ANALITICA", categoria, nivel: 4 },
  });
  return c.id;
}

async function seedPrestamoUsd(opts: {
  prestamista: string;
  principal: string;
  tcAlta: string;
}): Promise<{ cuentaBancariaId: string; prestamoCuentaId: number; prestamoId: string }> {
  const bancoContable = await mkCuenta(`BANCO USD ${opts.prestamista}`, "ACTIVO");
  const prestamoCuentaId = await mkCuenta(`PRÉSTAMO ${opts.prestamista}`, "PASIVO");
  const cuentaBancaria = await prisma.cuentaBancaria.create({
    data: {
      banco: `Bank ${opts.prestamista}`,
      tipo: "CUENTA_CORRIENTE",
      moneda: Moneda.USD,
      numero: `0001-${String(cuentaSeq).padStart(4, "0")}`,
      cuentaContableId: bancoContable,
    },
  });
  const prestamo = await prisma.prestamoExterno.create({
    data: {
      prestamista: opts.prestamista,
      cuentaBancariaId: cuentaBancaria.id,
      moneda: Moneda.USD,
      principal: opts.principal,
      tipoCambio: opts.tcAlta,
      clasificacion: PrestamoClasificacion.CORTO_PLAZO,
      cuentaContableId: prestamoCuentaId,
    },
  });
  const asiento = await crearAsientoPrestamo(prestamo.id, FECHA, prisma);
  await contabilizarAsiento(asiento.id, prisma);
  return { cuentaBancariaId: cuentaBancaria.id, prestamoCuentaId, prestamoId: prestamo.id };
}

describe("getPrestamosActivos — saldo USD", () => {
  it("préstamo USD vigente: expone saldoUsd = principal y saldoPendiente en ARS @ TC alta", async () => {
    const { prestamoId } = await seedPrestamoUsd({
      prestamista: "ACME",
      principal: "20000.00",
      tcAlta: "1000.000000",
    });

    const activos = await getPrestamosActivos();
    expect(activos).toHaveLength(1);
    const p = activos[0];
    expect(p.id).toBe(prestamoId);
    expect(p.moneda).toBe(Moneda.USD);
    expect(p.saldoUsd?.toFixed(2)).toBe("20000.00");
    expect(p.saldoPendiente.toFixed(2)).toBe("20000000.00"); // ARS @ TC alta 1000
    expect(p.principal.toFixed(2)).toBe("20000.00");
    expect(p.tipoCambio.toFixed(2)).toBe("1000.00");
    expect(p.equivalenteARS.toFixed(2)).toBe("20000000.00");
  });

  it("tras amortizar a TC mayor: saldoUsd invariante (no se distorsiona por el TC del pago)", async () => {
    const { cuentaBancariaId, prestamoCuentaId } = await seedPrestamoUsd({
      prestamista: "BETA",
      principal: "20000.00",
      tcAlta: "1000.000000",
    });

    // Amortiza 5.000 USD a TC 1500 (la diferencia va a 9.2.x, NO a la cuenta).
    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId,
      fecha: FECHA,
      moneda: Moneda.USD,
      tipoCambio: "1500.000000",
      lineas: [{ cuentaContableId: prestamoCuentaId, monto: "5000.00" }],
    });
    expect(res.ok).toBe(true);

    const activos = await getPrestamosActivos();
    expect(activos).toHaveLength(1);
    const p = activos[0];
    expect(p.saldoUsd?.toFixed(2)).toBe("15000.00"); // 20.000 − 5.000, invariante a TC
    expect(p.saldoPendiente.toFixed(2)).toBe("15000000.00"); // ARS @ TC alta
  });

  it("préstamo USD totalmente saldado: se filtra (saldoArs = 0)", async () => {
    const { cuentaBancariaId, prestamoCuentaId } = await seedPrestamoUsd({
      prestamista: "GAMMA",
      principal: "10000.00",
      tcAlta: "1000.000000",
    });

    const res = await crearMovimientoTesoreriaAction({
      tipo: "PAGO",
      cuentaBancariaId,
      fecha: FECHA,
      moneda: Moneda.USD,
      tipoCambio: "1000.000000",
      lineas: [{ cuentaContableId: prestamoCuentaId, monto: "10000.00" }],
    });
    expect(res.ok).toBe(true);

    const activos = await getPrestamosActivos();
    expect(activos).toHaveLength(0);
  });
});
