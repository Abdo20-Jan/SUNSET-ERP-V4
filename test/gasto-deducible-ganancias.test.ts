import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createTestDb, type TestDb } from "./db";

// Campo fiscal `deducibleGanancias` (NETO/TOTAL/NO_DEDUCIBLE) en Gasto.
// Es INFORMATIVO: clasifica cómo deduce el gasto en Ganancias, pero NO altera
// el asiento contable. Estas pruebas cubren:
//   1. el schema de validación (gastoInputSchema) — default NETO + 3 valores;
//   2. la persistencia vía guardarGastoAction + lectura por obtenerGastoPorId;
//   3. la invariante: el asiento de gasto NO cambia con el valor del campo.

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
// guardarGastoAction/contabilizarGastoAction llaman revalidatePath, que exige
// el runtime de Next — lo mockeamos para poder invocar las actions en el test.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { gastoInputSchema, type GastoInput } from "@/lib/actions/gasto-schema";
import {
  guardarGastoAction,
  obtenerGastoPorId,
  contabilizarGastoAction,
} from "@/lib/actions/gastos";

describe("gastoInputSchema — deducibleGanancias (validación)", () => {
  const base: Omit<GastoInput, "deducibleGanancias"> = {
    numero: "G-2026-0001",
    proveedorId: "11111111-1111-4111-8111-111111111111",
    fecha: "2026-05-10",
    condicionPago: "CUENTA_CORRIENTE",
    moneda: "ARS",
    tipoCambio: "1",
    lineas: [{ cuentaContableGastoId: 1, descripcion: "Servicio", subtotal: "1000.00" }],
  };

  it("aplica default NETO cuando no se envía", () => {
    const parsed = gastoInputSchema.parse(base);
    expect(parsed.deducibleGanancias).toBe("NETO");
  });

  it("acepta los 3 valores válidos", () => {
    for (const v of ["NETO", "TOTAL", "NO_DEDUCIBLE"] as const) {
      const parsed = gastoInputSchema.parse({ ...base, deducibleGanancias: v });
      expect(parsed.deducibleGanancias).toBe(v);
    }
  });

  it("rechaza un valor fuera del enum", () => {
    const r = gastoInputSchema.safeParse({ ...base, deducibleGanancias: "OTRO" });
    expect(r.success).toBe(false);
  });
});

describe("Gasto.deducibleGanancias — persistencia + invariante de asiento", () => {
  let db: TestDb;
  let gastoSeq = 0;

  beforeAll(async () => {
    db = await createTestDb();
    h.setClient(db.prisma);
  });

  afterAll(async () => {
    await db?.stop();
  });

  beforeEach(async () => {
    await db.reset([
      "LineaAsiento",
      "Asiento",
      "LineaGasto",
      "Gasto",
      "Proveedor",
      "CuentaContable",
      "PeriodoContable",
    ]);
  });

  async function seedPeriodo() {
    return db.prisma.periodoContable.create({
      data: {
        codigo: "2026-05",
        nombre: "Mayo 2026",
        fechaInicio: new Date("2026-05-01"),
        fechaFin: new Date("2026-05-31"),
        estado: "ABIERTO",
      },
    });
  }

  async function seedCuenta(codigo: string, categoria: "PASIVO" | "EGRESO") {
    return db.prisma.cuentaContable.create({
      data: {
        codigo,
        nombre: `Cuenta ${codigo}`,
        tipo: "ANALITICA",
        categoria,
        nivel: 4,
      },
    });
  }

  async function seedProveedor(cuentaPasivoId: number) {
    return db.prisma.proveedor.create({
      data: {
        nombre: "Proveedor Local SA",
        tipoProveedor: "OTRO",
        cuentaContableId: cuentaPasivoId,
      },
    });
  }

  function buildInput(
    proveedorId: string,
    cuentaGastoId: number,
    deducible?: GastoInput["deducibleGanancias"],
  ): GastoInput {
    return {
      numero: `G-2026-${(++gastoSeq).toString().padStart(4, "0")}`,
      proveedorId,
      fecha: "2026-05-10",
      condicionPago: "CUENTA_CORRIENTE",
      moneda: "ARS",
      tipoCambio: "1",
      ...(deducible ? { deducibleGanancias: deducible } : {}),
      lineas: [
        { cuentaContableGastoId: cuentaGastoId, descripcion: "Servicio", subtotal: "1000.00" },
      ],
    };
  }

  it("guarda con default NETO cuando no se especifica", async () => {
    const pasivo = await seedCuenta("2.1.1.01", "PASIVO");
    const gastoCta = await seedCuenta("5.1.1.01", "EGRESO");
    const prov = await seedProveedor(pasivo.id);

    const res = await guardarGastoAction(buildInput(prov.id, gastoCta.id));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const detalle = await obtenerGastoPorId(res.id);
    expect(detalle?.deducibleGanancias).toBe("NETO");
  });

  it("persiste TOTAL y NO_DEDUCIBLE y los lee de vuelta", async () => {
    const pasivo = await seedCuenta("2.1.1.01", "PASIVO");
    const gastoCta = await seedCuenta("5.1.1.01", "EGRESO");
    const prov = await seedProveedor(pasivo.id);

    for (const v of ["TOTAL", "NO_DEDUCIBLE"] as const) {
      const res = await guardarGastoAction(buildInput(prov.id, gastoCta.id, v));
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      const detalle = await obtenerGastoPorId(res.id);
      expect(detalle?.deducibleGanancias).toBe(v);
    }
  });

  it("el asiento de gasto NO cambia con el valor de deducibleGanancias", async () => {
    const pasivo = await seedCuenta("2.1.1.01", "PASIVO");
    const gastoCta = await seedCuenta("5.1.1.01", "EGRESO");
    const prov = await seedProveedor(pasivo.id);
    await seedPeriodo();

    async function asientoLineasDe(deducible: GastoInput["deducibleGanancias"]) {
      const res = await guardarGastoAction(buildInput(prov.id, gastoCta.id, deducible));
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("guardado falló");
      const cont = await contabilizarGastoAction(res.id);
      expect(cont.ok).toBe(true);
      const g = await db.prisma.gasto.findUniqueOrThrow({
        where: { id: res.id },
        select: { asientoId: true },
      });
      const lineas = await db.prisma.lineaAsiento.findMany({
        where: { asientoId: g.asientoId! },
        orderBy: [{ cuentaId: "asc" }, { debe: "asc" }],
        select: { cuentaId: true, debe: true, haber: true },
      });
      return lineas.map((l) => ({
        cuentaId: l.cuentaId,
        debe: l.debe.toString(),
        haber: l.haber.toString(),
      }));
    }

    const neto = await asientoLineasDe("NETO");
    const total = await asientoLineasDe("TOTAL");
    const noDeducible = await asientoLineasDe("NO_DEDUCIBLE");

    // Mismo asiento (mismas cuentas y montos) independiente del campo fiscal.
    expect(total).toEqual(neto);
    expect(noDeducible).toEqual(neto);
  });

  // Decisión #9: el "otros" del header de la factura NO se imputa a la primera
  // línea de gasto (ensucia esa cuenta específica); va a una cuenta dedicada
  // OTROS GASTOS (7.9.99), igual que crearAsientoCompra.
  it("'otros' del header va a la cuenta dedicada 7.9.99, no a la primera línea de gasto", async () => {
    const pasivo = await seedCuenta("2.1.1.01", "PASIVO");
    const gastoCta = await seedCuenta("5.1.1.01", "EGRESO");
    const prov = await seedProveedor(pasivo.id);
    await seedPeriodo();

    const input: GastoInput = {
      numero: `G-2026-${(++gastoSeq).toString().padStart(4, "0")}`,
      proveedorId: prov.id,
      fecha: "2026-05-10",
      condicionPago: "CUENTA_CORRIENTE",
      moneda: "ARS",
      tipoCambio: "1",
      otros: "200.00",
      lineas: [
        { cuentaContableGastoId: gastoCta.id, descripcion: "Servicio", subtotal: "1000.00" },
      ],
    };
    const res = await guardarGastoAction(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const cont = await contabilizarGastoAction(res.id);
    expect(cont.ok).toBe(true);

    const g = await db.prisma.gasto.findUniqueOrThrow({
      where: { id: res.id },
      select: { asientoId: true },
    });
    const lineas = await db.prisma.lineaAsiento.findMany({
      where: { asientoId: g.asientoId! },
      include: { cuenta: { select: { codigo: true } } },
    });
    const debePorCodigo = (codigo: string) =>
      lineas
        .filter((l) => l.cuenta.codigo === codigo)
        .reduce((acc, l) => acc + Number(l.debe), 0);

    // "otros" (200) en la cuenta dedicada; la línea de gasto sólo su subtotal (1000).
    expect(debePorCodigo("7.9.99")).toBeCloseTo(200, 2);
    expect(debePorCodigo("5.1.1.01")).toBeCloseTo(1000, 2);
  });
});
