import { describe, expect, it } from "vitest";
import {
  type CuentaPlan,
  naturalezaPorDefecto,
  PLAN_RT9,
  validarPlan,
} from "@/lib/services/plan-de-cuentas";

// Rebuild RT9 — el plan de cuentas v3 vive como dato estructurado (fuente única
// para el seed, el registry y el guard). `validarPlan` es la lógica del guard:
// fija las invariantes que el ADR exige (sin huérfanas, categoría coherente,
// ningún 5.x inventariable, regularizadoras con naturaleza explícita).

function mk(p: Partial<CuentaPlan> & { codigo: string }): CuentaPlan {
  return { nombre: p.codigo, tipo: "ANALITICA", categoria: "ACTIVO", ...p };
}

describe("validarPlan — guard de consistencia del plan RT9", () => {
  it("plan mínimo coherente → sin problemas", () => {
    const plan: CuentaPlan[] = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.1.01" }),
    ];
    expect(validarPlan(plan)).toEqual([]);
  });

  it("R1: analítica huérfana (padre sintético no declarado)", () => {
    const probs = validarPlan([mk({ codigo: "2.1.1.01", categoria: "PASIVO" })]);
    expect(probs.some((p) => p.regla === "R1_ORFA")).toBe(true);
  });

  it("R2: categoría incoherente con el dígito raíz", () => {
    const plan: CuentaPlan[] = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.1.01", categoria: "PASIVO" }), // dígito 1 = ACTIVO
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R2_CATEGORIA")).toBe(true);
  });

  it("R3: código bajo 5.x marcado inventariable", () => {
    const plan: CuentaPlan[] = [
      mk({ codigo: "5", tipo: "SINTETICA", categoria: "EGRESO" }),
      mk({ codigo: "5.1", tipo: "SINTETICA", categoria: "EGRESO" }),
      mk({ codigo: "5.1.1", tipo: "SINTETICA", categoria: "EGRESO" }),
      mk({ codigo: "5.1.1.01", categoria: "EGRESO", inventariable: true }),
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R3_INVENTARIABLE_5X")).toBe(true);
  });

  it("R4: regularizadora '(-)' sin naturaleza explícita", () => {
    const plan: CuentaPlan[] = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.7", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.7.09", nombre: "(-) DESVALORIZACIÓN DE BIENES DE CAMBIO" }),
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R4_REGULARIZADORA")).toBe(true);
  });

  it("R4: regularizadora con naturaleza = al default (no invertida) también falla", () => {
    const plan: CuentaPlan[] = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.7", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.7.09", nombre: "(-) DESVALORIZACIÓN", naturaleza: "DEUDOR" }), // ACTIVO default
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R4_REGULARIZADORA")).toBe(true);
  });

  it("R5: código duplicado", () => {
    const plan: CuentaPlan[] = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1", tipo: "SINTETICA" }),
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R5_DUP")).toBe(true);
  });

  it("naturalezaPorDefecto: ACTIVO/EGRESO=DEUDOR, resto=ACREEDOR", () => {
    expect(naturalezaPorDefecto("ACTIVO")).toBe("DEUDOR");
    expect(naturalezaPorDefecto("EGRESO")).toBe("DEUDOR");
    expect(naturalezaPorDefecto("PASIVO")).toBe("ACREEDOR");
    expect(naturalezaPorDefecto("PATRIMONIO")).toBe("ACREEDOR");
    expect(naturalezaPorDefecto("INGRESO")).toBe("ACREEDOR");
  });
});

describe("PLAN_RT9 — el plan v3 real", () => {
  it("es internamente consistente (pasa el guard)", () => {
    expect(validarPlan(PLAN_RT9)).toEqual([]);
  });

  it("incluye los rubros raíz 1..5 como SINTÉTICA", () => {
    for (const raiz of ["1", "2", "3", "4", "5"]) {
      const c = PLAN_RT9.find((x) => x.codigo === raiz);
      expect(c?.tipo).toBe("SINTETICA");
    }
  });

  it("las cuentas de Bienes de Cambio (1.1.7.0x) son inventariables y ninguna 5.x lo es", () => {
    const stock = PLAN_RT9.filter((c) => /^1\.1\.7\.0[1-5]$/.test(c.codigo));
    expect(stock.length).toBe(5);
    expect(stock.every((c) => c.inventariable === true)).toBe(true);
    expect(PLAN_RT9.some((c) => c.codigo.startsWith("5.") && c.inventariable)).toBe(false);
  });

  it("tiene el par único de diferencia de cambio (4.3.1.02 ganancia / 5.8.1.02 pérdida)", () => {
    expect(PLAN_RT9.find((c) => c.codigo === "4.3.1.02")).toBeDefined();
    expect(PLAN_RT9.find((c) => c.codigo === "5.8.1.02")).toBeDefined();
  });
});
