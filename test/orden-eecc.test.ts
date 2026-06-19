import { describe, expect, it } from "vitest";
import { naturalezaEfectiva } from "@/lib/services/cuenta-naturaleza";
import { BALANCE_RUBROS, rubroEECCDeCuenta } from "@/lib/services/orden-eecc";
import { PLAN_CUENTAS, planEntryToSeedRecord } from "@/lib/services/plan-de-cuentas";

describe("orden-eecc — BALANCE_RUBROS", () => {
  it("tiene 38 rubros (34 del Excel + 4 de PN), con prefijos únicos", () => {
    expect(BALANCE_RUBROS).toHaveLength(38);
    const prefijos = BALANCE_RUBROS.map((r) => r.prefijo);
    expect(new Set(prefijos).size).toBe(prefijos.length);
  });

  it("respeta el orden del Excel por grupo (orden incremental dentro del grupo)", () => {
    const porGrupo = new Map<string, number[]>();
    for (const r of BALANCE_RUBROS) {
      const arr = porGrupo.get(r.grupo) ?? [];
      arr.push(r.orden);
      porGrupo.set(r.grupo, arr);
    }
    for (const [, ordenes] of porGrupo) {
      expect(ordenes).toEqual([...ordenes].sort((a, b) => a - b));
      expect(ordenes[0]).toBe(1);
    }
  });
});

describe("rubroEECCDeCuenta — derivación por código", () => {
  it("balance: cuenta cae en el rubro de su ancestro de nivel 3 (clases 1/2)", () => {
    expect(rubroEECCDeCuenta("1.1.1.01.01")).toBe("Caja y bancos");
    expect(rubroEECCDeCuenta("1.1.7.03")).toBe("Bienes de cambio");
    expect(rubroEECCDeCuenta("1.2.10.01")).toBe("Activo por impuesto diferido");
    expect(rubroEECCDeCuenta("2.1.1.01")).toBe("Cuentas por pagar comerciales");
    expect(rubroEECCDeCuenta("2.2.7.05")).toBe("Previsiones no corrientes");
  });

  it("desambigua 1.2.1 de 1.2.10 / 1.2.11 (el '.' final del prefijo)", () => {
    expect(rubroEECCDeCuenta("1.2.1.03")).toBe("Inversiones financieras no corrientes");
    expect(rubroEECCDeCuenta("1.2.11.02")).toBe("Otros activos no corrientes");
  });

  it("PN: nivel 2 (clase 3)", () => {
    expect(rubroEECCDeCuenta("3.1.01")).toBe("Aportes de los propietarios");
    expect(rubroEECCDeCuenta("3.4.01")).toBe("Resultado del ejercicio");
  });

  it("resultado: sub/clase (clases 4-9)", () => {
    expect(rubroEECCDeCuenta("4.1.01")).toBe("Ingresos por ventas");
    expect(rubroEECCDeCuenta("5.2.03")).toBe("Costo de ventas");
    expect(rubroEECCDeCuenta("8.9.01")).toBe("Impuesto a las ganancias");
    expect(rubroEECCDeCuenta("9.2.01")).toBe("Resultados financieros y de tenencia");
  });

  it("null en las sintéticas de agrupación por encima del nivel de rubro", () => {
    expect(rubroEECCDeCuenta("1")).toBeNull();
    expect(rubroEECCDeCuenta("1.1")).toBeNull();
    expect(rubroEECCDeCuenta("2.2")).toBeNull();
    expect(rubroEECCDeCuenta("3")).toBeNull();
  });
});

describe("cobertura del plan — rubroEECC", () => {
  it("toda cuenta ANALÍTICA del plan recibe un rubroEECC no nulo", () => {
    const sinRubro = PLAN_CUENTAS.filter((c) => c.tipo === "ANALITICA").filter(
      (c) => planEntryToSeedRecord(c).rubroEECC === null,
    );
    expect(sinRubro.map((c) => c.codigo)).toEqual([]);
  });

  it("planEntryToSeedRecord propaga el rubro derivado del código", () => {
    const cuenta = PLAN_CUENTAS.find((c) => c.codigo === "1.1.7.01");
    expect(cuenta).toBeDefined();
    if (cuenta) expect(planEntryToSeedRecord(cuenta).rubroEECC).toBe("Bienes de cambio");
  });
});

describe("naturalezaEfectiva — MIXTA / SISTEMA_VARIABLE caen al defecto de la categoría", () => {
  it("DEUDOR/ACREEDOR mandan tal cual", () => {
    expect(naturalezaEfectiva("DEUDOR", "PASIVO")).toBe("DEUDOR");
    expect(naturalezaEfectiva("ACREEDOR", "ACTIVO")).toBe("ACREEDOR");
  });

  it("resultado mixto (categoría EGRESO) → DEUDOR; PN de cierre → ACREEDOR", () => {
    expect(naturalezaEfectiva("MIXTA", "EGRESO")).toBe("DEUDOR");
    expect(naturalezaEfectiva("SISTEMA_VARIABLE", "EGRESO")).toBe("DEUDOR");
    expect(naturalezaEfectiva("SISTEMA_VARIABLE", "PATRIMONIO")).toBe("ACREEDOR");
    expect(naturalezaEfectiva(null, "ACTIVO")).toBe("DEUDOR");
  });
});
