import { describe, expect, it } from "vitest";
import {
  categoriaPorClase,
  type CuentaPlan,
  monedaDeCuenta,
  naturalezaPorDefecto,
  PLAN_CUENTAS,
  planEntryToSeedRecord,
  validarPlan,
} from "@/lib/services/plan-de-cuentas";

// Plan de cuentas — modelo de 9 clases del Excel maestro `PLANO DE CONTAS FINAL`
// (631 cuentas). El plan vive como dato (`plan-de-cuentas.data.ts`, generado);
// `validarPlan` fija las invariantes estructurales que el Excel cumple 100%.

let _ord = 0;
function mk(p: Partial<CuentaPlan> & { codigo: string }): CuentaPlan {
  const tipo = p.tipo ?? "ANALITICA";
  return {
    orden: ++_ord,
    nombre: p.codigo,
    clase: Number(p.codigo.split(".")[0]),
    clasificacion: "CORRIENTE",
    tipo,
    naturaleza: "DEUDOR",
    imputacion: tipo === "SINTETICA" ? "NO_IMPUTABLE" : "IMPUTABLE",
    regularizadora: false,
    bimonetaria: false,
    monedaExtranjera: false,
    enEspecie: false,
    inventariable: false,
    sistema: false,
    dinamica: false,
    ...p,
  };
}

describe("validarPlan — guard de consistencia del plan", () => {
  it("plan mínimo coherente → sin problemas", () => {
    const plan: CuentaPlan[] = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.1.01" }),
    ];
    expect(validarPlan(plan)).toEqual([]);
  });

  it("R_DUP: código duplicado", () => {
    const plan = [mk({ codigo: "1", tipo: "SINTETICA" }), mk({ codigo: "1", tipo: "SINTETICA" })];
    expect(validarPlan(plan).some((p) => p.regla === "R_DUP")).toBe(true);
  });

  it("R_ORDEN: orden duplicado", () => {
    const plan = [
      mk({ codigo: "1", tipo: "SINTETICA", orden: 7 }),
      mk({ codigo: "2", tipo: "SINTETICA", orden: 7 }),
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R_ORDEN")).toBe(true);
  });

  it("R_CLASE: clase ≠ dígito raíz", () => {
    expect(
      validarPlan([mk({ codigo: "1", tipo: "SINTETICA", clase: 2 })]).some(
        (p) => p.regla === "R_CLASE",
      ),
    ).toBe(true);
  });

  it("R_CLASIF: clasificacion no válida para la clase (clase 1 con RESULTADO)", () => {
    expect(
      validarPlan([mk({ codigo: "1", tipo: "SINTETICA", clasificacion: "RESULTADO" })]).some(
        (p) => p.regla === "R_CLASIF",
      ),
    ).toBe(true);
  });

  it("R_ORFA: padre sintético no declarado", () => {
    expect(
      validarPlan([mk({ codigo: "2.1.1.01", clase: 2 })]).some((p) => p.regla === "R_ORFA"),
    ).toBe(true);
  });

  it("R_ORFA: padre declarado pero ANALÍTICA (no sintética)", () => {
    const plan = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1" }),
      mk({ codigo: "1.1.1" }),
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R_ORFA")).toBe(true);
  });

  it("R_IMPUT: sintética marcada imputable", () => {
    expect(
      validarPlan([mk({ codigo: "1", tipo: "SINTETICA", imputacion: "IMPUTABLE" })]).some(
        (p) => p.regla === "R_IMPUT",
      ),
    ).toBe(true);
  });

  it("R_IMPUT: analítica marcada no imputable", () => {
    const plan = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1", tipo: "ANALITICA", imputacion: "NO_IMPUTABLE" }),
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R_IMPUT")).toBe(true);
  });

  it("R_INVENTARIABLE: inventariable fuera de ACTIVO (clase ≠ 1)", () => {
    const plan = [
      mk({ codigo: "5", tipo: "SINTETICA", clase: 5 }),
      mk({ codigo: "5.1", clase: 5, inventariable: true }),
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R_INVENTARIABLE")).toBe(true);
  });

  it("R_REGULARIZADORA: regularizadora con naturaleza = al default (no invertida)", () => {
    // ACTIVO default = DEUDOR; una regularizadora de activo debe ser ACREEDOR.
    const plan = [
      mk({ codigo: "1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1", tipo: "SINTETICA" }),
      mk({ codigo: "1.1.09", regularizadora: true, naturaleza: "DEUDOR" }),
    ];
    expect(validarPlan(plan).some((p) => p.regla === "R_REGULARIZADORA")).toBe(true);
  });
});

describe("helpers de derivación", () => {
  it("categoriaPorClase: 1→ACTIVO 2→PASIVO 3→PATRIMONIO 4→INGRESO 5..9→EGRESO", () => {
    expect(categoriaPorClase(1)).toBe("ACTIVO");
    expect(categoriaPorClase(2)).toBe("PASIVO");
    expect(categoriaPorClase(3)).toBe("PATRIMONIO");
    expect(categoriaPorClase(4)).toBe("INGRESO");
    for (const c of [5, 6, 7, 8, 9]) expect(categoriaPorClase(c)).toBe("EGRESO");
  });

  it("naturalezaPorDefecto: ACTIVO/EGRESO=DEUDOR, resto=ACREEDOR", () => {
    expect(naturalezaPorDefecto("ACTIVO")).toBe("DEUDOR");
    expect(naturalezaPorDefecto("EGRESO")).toBe("DEUDOR");
    expect(naturalezaPorDefecto("PASIVO")).toBe("ACREEDOR");
    expect(naturalezaPorDefecto("PATRIMONIO")).toBe("ACREEDOR");
    expect(naturalezaPorDefecto("INGRESO")).toBe("ACREEDOR");
  });

  it("monedaDeCuenta: ME pura > bimonetaria > ARS (null)", () => {
    expect(monedaDeCuenta(mk({ codigo: "1.1.1.01.91", monedaExtranjera: true }))).toBe("ME");
    expect(monedaDeCuenta(mk({ codigo: "1.1.7.01", bimonetaria: true }))).toBe("BI");
    expect(monedaDeCuenta(mk({ codigo: "1.1.1.01.01" }))).toBeNull();
  });
});

describe("PLAN_CUENTAS — el plan real (631 cuentas)", () => {
  it("es internamente consistente (pasa el guard)", () => {
    expect(validarPlan(PLAN_CUENTAS)).toEqual([]);
  });

  it("tiene exactamente 631 cuentas con código y orden únicos", () => {
    expect(PLAN_CUENTAS.length).toBe(631);
    expect(new Set(PLAN_CUENTAS.map((c) => c.codigo)).size).toBe(631);
    expect(new Set(PLAN_CUENTAS.map((c) => c.orden)).size).toBe(631);
  });

  it("las 9 raíces 1..9 son SINTÉTICAS", () => {
    for (const raiz of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      expect(PLAN_CUENTAS.find((c) => c.codigo === raiz)?.tipo).toBe("SINTETICA");
    }
  });

  it("sólo cuentas de ACTIVO (clase 1) son inventariables", () => {
    const inv = PLAN_CUENTAS.filter((c) => c.inventariable);
    expect(inv.length).toBeGreaterThan(0);
    expect(inv.every((c) => c.clase === 1)).toBe(true);
  });
});

describe("planEntryToSeedRecord — proyección al registro de CuentaContable", () => {
  it("deriva nivel (segmentos) y padreCodigo (todo antes del último '.')", () => {
    const r = planEntryToSeedRecord(mk({ codigo: "1.1.5.1.01" }));
    expect(r.nivel).toBe(5);
    expect(r.padreCodigo).toBe("1.1.5.1");
  });

  it("una raíz no tiene padre (padreCodigo null, nivel 1)", () => {
    const r = planEntryToSeedRecord(mk({ codigo: "1", tipo: "SINTETICA" }));
    expect(r.nivel).toBe(1);
    expect(r.padreCodigo).toBeNull();
  });

  it("deriva categoria (legada) de la clase y rubroEECC queda null en esta etapa", () => {
    const r = planEntryToSeedRecord(mk({ codigo: "5.1.01", clase: 5 }));
    expect(r.categoria).toBe("EGRESO");
    expect(r.rubroEECC).toBeNull();
  });

  it("deriva moneda de las flags (ME/BI/null) y persiste los 11 atributos nuevos", () => {
    const r = planEntryToSeedRecord(
      mk({
        codigo: "1.1.1.01.91",
        orden: 42,
        clasificacion: "CORRIENTE",
        imputacion: "IMPUTABLE",
        monedaExtranjera: true,
        dinamica: true,
      }),
    );
    expect(r.moneda).toBe("ME");
    expect(r.orden).toBe(42);
    expect(r.clase).toBe(1);
    expect(r.clasificacion).toBe("CORRIENTE");
    expect(r.imputacion).toBe("IMPUTABLE");
    expect(r.monedaExtranjera).toBe(true);
    expect(r.dinamica).toBe(true);
  });

  it("todo PLAN_CUENTAS se proyecta con padreCodigo que existe en el propio plan", () => {
    const codigos = new Set(PLAN_CUENTAS.map((c) => c.codigo));
    for (const c of PLAN_CUENTAS) {
      const r = planEntryToSeedRecord(c);
      if (r.padreCodigo !== null) {
        expect(codigos.has(r.padreCodigo), `${r.codigo} → padre ${r.padreCodigo}`).toBe(true);
      }
    }
  });
});
