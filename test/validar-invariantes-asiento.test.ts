import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { AsientoEstado, Moneda, type PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";
import { validarAsientos } from "../prisma/validar-invariantes-asiento";

// E6 — Validador de invariante contable del ledger (espelha validar-stock).
//
// Invariantes (sobre TODOS los asientos, cualquier estado):
//   A1: Asiento.moneda == ARS (libro diario en pesos)
//   A2: totalDebe == totalHaber (partida doble)
//   A3: Σ líneas.debe == totalDebe  y  Σ líneas.haber == totalHaber
//   A4: cada línea tiene EXACTAMENTE un lado > 0 (debe XOR haber), no-negativo
//   A5: monedaOrigen ∈ {USD, null}; si USD → montoOrigen>0 y tipoCambioOrigen>0;
//       si null → montoOrigen y tipoCambioOrigen ambos null
//
// El validador recibe el PrismaClient directo (no usa actions ni auth), así que
// no necesita los mocks de db/auth/next-cache; sembramos violaciones a mano
// (sin pasar por el motor) para poder generar datos inválidos a propósito.

let testDb: TestDb;
let prisma: PrismaClient;

const TABLES = ["LineaAsiento", "Asiento", "CuentaContable", "PeriodoContable"] as const;
const FECHA = new Date("2025-06-15T12:00:00.000Z");

beforeAll(async () => {
  testDb = await createTestDb();
  prisma = testDb.prisma;
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
});

let cuentaSeq = 0;
async function mkCuenta(): Promise<number> {
  cuentaSeq += 1;
  const codigo = `7.7.7.${String(cuentaSeq).padStart(2, "0")}`;
  const c = await prisma.cuentaContable.create({
    data: {
      codigo,
      nombre: `Cuenta ${cuentaSeq}`,
      tipo: "ANALITICA",
      categoria: "ACTIVO",
      nivel: 4,
    },
  });
  return c.id;
}

type LineaSeed = {
  cuentaId: number;
  debe?: string;
  haber?: string;
  monedaOrigen?: Moneda | null;
  montoOrigen?: string | null;
  tipoCambioOrigen?: string | null;
};

let asientoSeq = 0;
async function mkAsiento(opts: {
  estado?: AsientoEstado;
  moneda?: Moneda;
  /** Override del total (para sembrar violaciones A2/A3). Por defecto = Σ líneas. */
  totalDebe?: string;
  totalHaber?: string;
  lineas: LineaSeed[];
}): Promise<string> {
  asientoSeq += 1;
  const sumDebe = opts.lineas.reduce((s, l) => s.plus(new Decimal(l.debe ?? 0)), new Decimal(0));
  const sumHaber = opts.lineas.reduce((s, l) => s.plus(new Decimal(l.haber ?? 0)), new Decimal(0));
  const a = await prisma.asiento.create({
    data: {
      numero: asientoSeq,
      fecha: FECHA,
      descripcion: "seed",
      estado: opts.estado ?? AsientoEstado.CONTABILIZADO,
      origen: "TESORERIA",
      moneda: opts.moneda ?? Moneda.ARS,
      tipoCambio: 1,
      totalDebe: opts.totalDebe ?? sumDebe.toFixed(2),
      totalHaber: opts.totalHaber ?? sumHaber.toFixed(2),
      periodoId,
      lineas: {
        create: opts.lineas.map((l) => ({
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
  return a.id;
}

/** Asiento canónico válido: factura USD 25.000 @ 1.200 (banco/proveedor). */
async function asientoValido(estado?: AsientoEstado): Promise<void> {
  const banco = await mkCuenta();
  const proveedor = await mkCuenta();
  await mkAsiento({
    estado,
    lineas: [
      { cuentaId: banco, debe: "30000000.00" },
      {
        cuentaId: proveedor,
        haber: "30000000.00",
        monedaOrigen: Moneda.USD,
        montoOrigen: "25000.00",
        tipoCambioOrigen: "1200.000000",
      },
    ],
  });
}

// ============================================================
// Casos OK (sin violaciones)
// ============================================================

describe("validarAsientos — sin violaciones", () => {
  it("asiento canónico válido (ARS + línea USD-meta) → []", async () => {
    await asientoValido();
    expect(await validarAsientos(prisma)).toEqual([]);
  });

  it("varios asientos válidos en distintos estados → []", async () => {
    await asientoValido(AsientoEstado.CONTABILIZADO);
    await asientoValido(AsientoEstado.BORRADOR);
    await asientoValido(AsientoEstado.ANULADO);
    expect(await validarAsientos(prisma)).toEqual([]);
  });

  it("base vacía → []", async () => {
    expect(await validarAsientos(prisma)).toEqual([]);
  });
});

// ============================================================
// A1 — moneda única ARS
// ============================================================

describe("validarAsientos — A1 moneda", () => {
  it("asiento con moneda != ARS → viola A1", async () => {
    const a = await mkCuenta();
    const b = await mkCuenta();
    await mkAsiento({
      moneda: Moneda.USD,
      lineas: [
        { cuentaId: a, debe: "100.00" },
        { cuentaId: b, haber: "100.00" },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A1");
  });
});

// ============================================================
// A2 — partida doble (totales)
// ============================================================

describe("validarAsientos — A2 partida doble", () => {
  it("totalDebe != totalHaber (líneas que NO balancean, totales fieles a líneas) → viola sólo A2", async () => {
    const a = await mkCuenta();
    const b = await mkCuenta();
    // Líneas: Σdebe=30M, Σhaber=29M. Totales = Σ líneas (A3 pasa), pero
    // totalDebe != totalHaber (A2 falla).
    await mkAsiento({
      totalDebe: "30000000.00",
      totalHaber: "29000000.00",
      lineas: [
        { cuentaId: a, debe: "30000000.00" },
        { cuentaId: b, haber: "29000000.00" },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A2");
  });
});

// ============================================================
// A3 — totales == Σ líneas
// ============================================================

describe("validarAsientos — A3 totales vs líneas", () => {
  it("totales que NO coinciden con la suma de líneas → viola A3", async () => {
    const a = await mkCuenta();
    const b = await mkCuenta();
    // Líneas balancean (Σ=30M/30M) pero totales inflados a 31M (A2 pasa: 31==31).
    await mkAsiento({
      totalDebe: "31000000.00",
      totalHaber: "31000000.00",
      lineas: [
        { cuentaId: a, debe: "30000000.00" },
        { cuentaId: b, haber: "30000000.00" },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A3");
  });

  it("asiento sin líneas con totales != 0 → viola A3", async () => {
    await mkAsiento({ totalDebe: "100.00", totalHaber: "100.00", lineas: [] });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A3");
  });
});

// ============================================================
// A4 — XOR debe/haber + no-negativo
// ============================================================

describe("validarAsientos — A4 línea XOR", () => {
  it("línea con debe>0 Y haber>0 → viola A4", async () => {
    const a = await mkCuenta();
    await mkAsiento({ lineas: [{ cuentaId: a, debe: "100.00", haber: "100.00" }] });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A4");
  });

  it("línea con ambos lados en 0 → viola A4", async () => {
    const a = await mkCuenta();
    await mkAsiento({ lineas: [{ cuentaId: a, debe: "0", haber: "0" }] });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A4");
  });
});

// ============================================================
// A5 — metadata USD consistente
// ============================================================

describe("validarAsientos — A5 metadata USD", () => {
  it("monedaOrigen=USD sin montoOrigen → viola A5", async () => {
    const banco = await mkCuenta();
    const prov = await mkCuenta();
    await mkAsiento({
      lineas: [
        { cuentaId: banco, debe: "30000000.00" },
        {
          cuentaId: prov,
          haber: "30000000.00",
          monedaOrigen: Moneda.USD,
          montoOrigen: null,
          tipoCambioOrigen: "1200.000000",
        },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A5");
  });

  it("monedaOrigen=USD sin tipoCambioOrigen → viola A5", async () => {
    const banco = await mkCuenta();
    const prov = await mkCuenta();
    await mkAsiento({
      lineas: [
        { cuentaId: banco, debe: "30000000.00" },
        {
          cuentaId: prov,
          haber: "30000000.00",
          monedaOrigen: Moneda.USD,
          montoOrigen: "25000.00",
          tipoCambioOrigen: null,
        },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A5");
  });

  it("monedaOrigen=null con montoOrigen seteado (metadata huérfana) → viola A5", async () => {
    const banco = await mkCuenta();
    const prov = await mkCuenta();
    await mkAsiento({
      lineas: [
        { cuentaId: banco, debe: "30000000.00" },
        { cuentaId: prov, haber: "30000000.00", monedaOrigen: null, montoOrigen: "25000.00" },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A5");
  });

  it("monedaOrigen=ARS (debe ser USD o null) → viola A5", async () => {
    const banco = await mkCuenta();
    const prov = await mkCuenta();
    await mkAsiento({
      lineas: [
        { cuentaId: banco, debe: "30000000.00" },
        {
          cuentaId: prov,
          haber: "30000000.00",
          monedaOrigen: Moneda.ARS,
          montoOrigen: "30000000.00",
          tipoCambioOrigen: "1.000000",
        },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A5");
  });
});

// ============================================================
// Agregación
// ============================================================

describe("validarAsientos — agregación", () => {
  it("un asiento con 2 problemas (A1 + A5) → 2 violaciones", async () => {
    const banco = await mkCuenta();
    const prov = await mkCuenta();
    await mkAsiento({
      moneda: Moneda.USD, // A1
      lineas: [
        { cuentaId: banco, debe: "30000000.00" },
        {
          cuentaId: prov,
          haber: "30000000.00",
          monedaOrigen: Moneda.USD,
          montoOrigen: null, // A5
          tipoCambioOrigen: "1200.000000",
        },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(2);
    const invs = v.map((x) => x.invariante);
    expect(invs.some((i) => i.includes("A1"))).toBe(true);
    expect(invs.some((i) => i.includes("A5"))).toBe(true);
  });

  it("convive un asiento válido con uno inválido → sólo reporta el inválido", async () => {
    await asientoValido();
    const a = await mkCuenta();
    const b = await mkCuenta();
    await mkAsiento({
      moneda: Moneda.USD,
      lineas: [
        { cuentaId: a, debe: "100.00" },
        { cuentaId: b, haber: "100.00" },
      ],
    });
    const v = await validarAsientos(prisma);
    expect(v).toHaveLength(1);
    expect(v[0]?.invariante).toContain("A1");
  });
});
