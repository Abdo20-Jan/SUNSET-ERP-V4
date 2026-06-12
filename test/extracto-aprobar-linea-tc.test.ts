import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// aprobarLineaAction — TC real obligatorio en extractos de cuenta en moneda
// extranjera.
//
// Bug original (auditoría 2026-06, PE.5): el ternario
// `moneda === ARS ? "1" : "1"` grababa SIEMPRE tipoCambio=1, incluso para
// cuentas bancarias USD. El movimiento y su asiento quedaban con TC=1 y
// cualquier conversión posterior (diferencia cambiaria, reportes) partía de
// un TC falso.
//
// Regla nueva: cuenta ARS → TC=1; cuenta extranjera → TC manual del
// aprobador (prioridad) → cotización vigente a la fecha de la línea →
// error claro (la línea queda PENDIENTE, sin movimiento).

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

import { aprobarLineaAction } from "@/lib/actions/extractos";

interface Seed {
  importacionId: string;
  cuentaGastoId: number;
}

describe("aprobarLineaAction — TC real en extracto de cuenta extranjera", () => {
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
    await db.reset([
      "LineaExtractoSugerencia",
      "ImportacionExtracto",
      "MovimientoTesoreria",
      "LineaAsiento",
      "Asiento",
      "Cotizacion",
      "CuentaBancaria",
      "PeriodoContable",
      "CuentaContable",
    ]);
  });

  async function seed(moneda: "ARS" | "USD"): Promise<Seed> {
    await db.prisma.periodoContable.create({
      data: {
        codigo: "2025-06",
        nombre: "Junio 2025",
        fechaInicio: new Date("2025-06-01T00:00:00.000Z"),
        fechaFin: new Date("2025-06-30T00:00:00.000Z"),
        estado: "ABIERTO",
      },
    });

    const cuentaBanco = await db.prisma.cuentaContable.create({
      data: {
        codigo: moneda === "ARS" ? "1.1.2.01" : "1.1.2.02",
        nombre: `BANCO SANTANDER ${moneda}`,
        tipo: "ANALITICA",
        categoria: "ACTIVO",
        nivel: 4,
      },
    });
    const cuentaGasto = await db.prisma.cuentaContable.create({
      data: {
        codigo: "5.2.1.01",
        nombre: "COMISIONES BANCARIAS",
        tipo: "ANALITICA",
        categoria: "EGRESO",
        nivel: 4,
      },
    });

    const cuentaBancaria = await db.prisma.cuentaBancaria.create({
      data: {
        banco: "Santander",
        tipo: "CUENTA_CORRIENTE",
        moneda,
        numero: "0001-0001",
        cuentaContableId: cuentaBanco.id,
      },
    });

    const importacion = await db.prisma.importacionExtracto.create({
      data: {
        cuentaBancariaId: cuentaBancaria.id,
        periodoYear: 2025,
        periodoMonth: 6,
        saldoInicial: "0.00",
        saldoFinal: "0.00",
        totalLineas: 1,
      },
    });

    return { importacionId: importacion.id, cuentaGastoId: cuentaGasto.id };
  }

  async function crearLinea(
    s: Seed,
    opts?: { monto?: string; fecha?: Date },
  ): Promise<{ id: string }> {
    return db.prisma.lineaExtractoSugerencia.create({
      data: {
        importacionId: s.importacionId,
        ordenLinea: 1,
        fecha: opts?.fecha ?? new Date("2025-06-10T12:00:00.000Z"),
        descripcion: "TRANSFERENCIA RECIBIDA",
        monto: opts?.monto ?? "1500.00",
        cuentaSugeridaId: s.cuentaGastoId,
      },
      select: { id: true },
    });
  }

  it("cuenta ARS: aprueba con TC=1 e ignora un TC manual", async () => {
    const s = await seed("ARS");
    const linea = await crearLinea(s);

    // TC manual no aplica a cuentas ARS — el peso no se convierte.
    const r = await aprobarLineaAction(linea.id, { tipoCambio: 999 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: r.movimientoId },
    });
    expect(Number(mov.tipoCambio)).toBe(1);
    expect(mov.moneda).toBe("ARS");
    expect(mov.asientoId).not.toBeNull();
  });

  it("cuenta USD sin cotización ni TC manual: rechaza y la línea queda PENDIENTE", async () => {
    const s = await seed("USD");
    const linea = await crearLinea(s);

    const r = await aprobarLineaAction(linea.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("no hay cotización");

    const lineaDb = await db.prisma.lineaExtractoSugerencia.findUniqueOrThrow({
      where: { id: linea.id },
    });
    expect(lineaDb.status).toBe("PENDIENTE");
    expect(lineaDb.movimientoId).toBeNull();
    expect(await db.prisma.movimientoTesoreria.count()).toBe(0);
  });

  it("cuenta USD con cotización cargada: usa la vigente a la fecha de la línea", async () => {
    const s = await seed("USD");
    await db.prisma.cotizacion.createMany({
      data: [
        { fecha: new Date("2025-06-01T00:00:00.000Z"), valor: "1100.500000" },
        // Posterior a la línea (2025-06-10) — NO debe usarse.
        { fecha: new Date("2025-06-28T00:00:00.000Z"), valor: "1400.000000" },
      ],
    });
    const linea = await crearLinea(s);

    const r = await aprobarLineaAction(linea.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: r.movimientoId },
      include: { asiento: { select: { tipoCambio: true, moneda: true } } },
    });
    expect(Number(mov.tipoCambio)).toBeCloseTo(1100.5, 4);
    expect(mov.moneda).toBe("USD");
    // El asiento hereda el TC real del movimiento.
    expect(Number(mov.asiento?.tipoCambio)).toBeCloseTo(1100.5, 4);

    const lineaDb = await db.prisma.lineaExtractoSugerencia.findUniqueOrThrow({
      where: { id: linea.id },
    });
    expect(lineaDb.status).toBe("APROBADA");
  });

  it("cuenta USD con TC manual: el manual tiene prioridad sobre la cotización", async () => {
    const s = await seed("USD");
    await db.prisma.cotizacion.create({
      data: { fecha: new Date("2025-06-01T00:00:00.000Z"), valor: "1100.500000" },
    });
    const linea = await crearLinea(s);

    const r = await aprobarLineaAction(linea.id, { tipoCambio: 1300.25 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: r.movimientoId },
    });
    expect(Number(mov.tipoCambio)).toBeCloseTo(1300.25, 4);
  });

  it("cuenta USD con monto negativo (PAGO) también graba el TC real", async () => {
    const s = await seed("USD");
    const linea = await crearLinea(s, { monto: "-800.00" });

    const r = await aprobarLineaAction(linea.id, { tipoCambio: 1250 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const mov = await db.prisma.movimientoTesoreria.findUniqueOrThrow({
      where: { id: r.movimientoId },
    });
    expect(mov.tipo).toBe("PAGO");
    expect(Number(mov.tipoCambio)).toBeCloseTo(1250, 4);
    expect(Number(mov.monto)).toBeCloseTo(800, 2);
  });

  it("TC manual inválido (<= 0): rechaza antes de tocar la base", async () => {
    const s = await seed("USD");
    const linea = await crearLinea(s);

    const r = await aprobarLineaAction(linea.id, { tipoCambio: -5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("mayor a 0");
    expect(await db.prisma.movimientoTesoreria.count()).toBe(0);
  });
});
