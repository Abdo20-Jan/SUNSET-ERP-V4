import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/decimal";
import { categoriaPorClase, PLAN_RT9 } from "@/lib/services/plan-de-cuentas";
import {
  clasificarConceptoDRE,
  type ConceptoDREId,
  construirEstadoResultadosRT9,
  type LeafResultado,
} from "@/lib/services/reportes/estado-resultados-rt9";

// Estado de Resultados en el orden de exposición de los EECC (etapa 2): cascada
// de 21 conceptos del ORDEN EECC.xlsx. La contribución de cada cuenta es
// `haber − debe`; los subtotales (Ingresos netos → Resultado bruto → antes de
// impuesto → operaciones que continúan → del ejercicio) son snapshots del
// acumulado. El concepto se deriva del `rubroEECC` (que manda) o del prefijo.

function leaf(p: Partial<LeafResultado> & { codigo: string }): LeafResultado {
  return {
    categoria: p.codigo.startsWith("4") ? "INGRESO" : "EGRESO",
    rubroEECC: null,
    debe: new Decimal(0),
    haber: new Decimal(0),
    ...p,
  };
}

describe("clasificarConceptoDRE — concepto por código", () => {
  it("mapea cada sub/clase a su concepto del Excel", () => {
    expect(clasificarConceptoDRE("4.1.01.01")).toBe("INGRESOS_VENTAS");
    expect(clasificarConceptoDRE("4.2.01")).toBe("DEDUCCIONES");
    expect(clasificarConceptoDRE("4.3.01")).toBe("OTROS_INGRESOS_OPERATIVOS");
    expect(clasificarConceptoDRE("5.1.01")).toBe("COSTO_VENTAS");
    expect(clasificarConceptoDRE("6.3.01")).toBe("GASTOS_COMERCIALIZACION");
    expect(clasificarConceptoDRE("7.2.01")).toBe("GASTOS_ADMINISTRACION");
    expect(clasificarConceptoDRE("8.0.01")).toBe("OTROS_GASTOS_OPERATIVOS");
    expect(clasificarConceptoDRE("8.1.01")).toBe("CAMBIOS_PROP_INVERSION");
    expect(clasificarConceptoDRE("8.2.01")).toBe("PERDIDAS_DESVALORIZACION");
    expect(clasificarConceptoDRE("8.3.01")).toBe("OTROS_INGRESOS");
    expect(clasificarConceptoDRE("8.4.01")).toBe("OTROS_EGRESOS");
    expect(clasificarConceptoDRE("8.5.01")).toBe("RESULTADO_VENTA_BAJA_ACTIVOS");
    expect(clasificarConceptoDRE("8.6.01")).toBe("CONTINGENCIAS");
    expect(clasificarConceptoDRE("8.7.01")).toBe("MULTAS_SANCIONES");
    expect(clasificarConceptoDRE("8.8.05")).toBe("RESULTADO_OPERACIONES_DISCONTINUADAS");
    expect(clasificarConceptoDRE("8.9.01")).toBe("IMPUESTO_GANANCIAS");
    expect(clasificarConceptoDRE("9.2.01")).toBe("RESULTADOS_FINANCIEROS");
    expect(clasificarConceptoDRE("9.8.99")).toBe("RESULTADOS_FINANCIEROS");
  });

  it("rubroEECC manda sobre el código", () => {
    // Código sería CMV, pero el rubro fuerza Otros ingresos.
    expect(clasificarConceptoDRE("5.1.01", "Otros ingresos")).toBe("OTROS_INGRESOS");
    // Sin match de código; sólo el rubro clasifica.
    expect(clasificarConceptoDRE("0.0.0", "Resultados financieros y de tenencia")).toBe(
      "RESULTADOS_FINANCIEROS",
    );
  });

  it("no asigna concepto a un código fuera de las clases de resultado", () => {
    expect(clasificarConceptoDRE("1.1.7.01")).toBeNull();
  });
});

describe("construirEstadoResultadosRT9 — cascada de 21 conceptos", () => {
  const leaves: LeafResultado[] = [
    leaf({ codigo: "4.1.01", haber: new Decimal(1000) }),
    leaf({ codigo: "4.2.01", debe: new Decimal(50) }),
    leaf({ codigo: "4.3.01", haber: new Decimal(30) }),
    leaf({ codigo: "5.1.01", debe: new Decimal(400) }),
    leaf({ codigo: "6.3.01", debe: new Decimal(100) }),
    leaf({ codigo: "7.2.01", debe: new Decimal(80) }),
    leaf({ codigo: "8.0.01", debe: new Decimal(20) }),
    leaf({ codigo: "8.1.01", haber: new Decimal(10) }),
    leaf({ codigo: "8.2.01", debe: new Decimal(5) }),
    leaf({ codigo: "9.1.01", haber: new Decimal(40) }),
    leaf({ codigo: "9.2.02", debe: new Decimal(15) }),
    leaf({ codigo: "8.3.01", haber: new Decimal(12) }),
    leaf({ codigo: "8.4.01", debe: new Decimal(7) }),
    leaf({ codigo: "8.5.01", haber: new Decimal(8) }),
    leaf({ codigo: "8.6.01", debe: new Decimal(3) }),
    leaf({ codigo: "8.7.01", debe: new Decimal(6) }),
    leaf({ codigo: "8.9.01", debe: new Decimal(14) }),
    leaf({ codigo: "8.8.01", haber: new Decimal(50) }),
  ];
  const er = construirEstadoResultadosRT9(leaves);
  const val = (id: ConceptoDREId) =>
    er.conceptos.find((c) => c.id === id)?.total.toFixed(2) ?? "MISSING";

  it("expone los 22 conceptos en el orden del Excel", () => {
    const ids = er.conceptos.map((c) => c.id);
    expect(ids).toEqual([
      "INGRESOS_VENTAS",
      "DEDUCCIONES",
      "OTROS_INGRESOS_OPERATIVOS",
      "INGRESOS_NETOS",
      "COSTO_VENTAS",
      "RESULTADO_BRUTO",
      "GASTOS_COMERCIALIZACION",
      "GASTOS_ADMINISTRACION",
      "OTROS_GASTOS_OPERATIVOS",
      "CAMBIOS_PROP_INVERSION",
      "PERDIDAS_DESVALORIZACION",
      "RESULTADOS_FINANCIEROS",
      "OTROS_INGRESOS",
      "OTROS_EGRESOS",
      "RESULTADO_VENTA_BAJA_ACTIVOS",
      "CONTINGENCIAS",
      "MULTAS_SANCIONES",
      "RESULTADO_ANTES_IMPUESTO",
      "IMPUESTO_GANANCIAS",
      "RESULTADO_OPERACIONES_CONTINUAN",
      "RESULTADO_OPERACIONES_DISCONTINUADAS",
      "RESULTADO_EJERCICIO",
    ]);
  });

  it("4.3 (otros ingresos operativos) entra en Ingresos netos", () => {
    // 1000 − 50 + 30 = 980
    expect(val("INGRESOS_NETOS")).toBe("980.00");
  });

  it("encadena los subtotales", () => {
    expect(val("RESULTADO_BRUTO")).toBe("580.00"); // 980 − 400
    expect(val("RESULTADO_ANTES_IMPUESTO")).toBe("414.00");
    expect(val("RESULTADO_OPERACIONES_CONTINUAN")).toBe("400.00"); // 414 − 14
    expect(val("RESULTADO_EJERCICIO")).toBe("450.00"); // 400 + 50
  });

  it("resultado del ejercicio = Σ(haber − debe) de todas las cuentas", () => {
    const esperado = leaves.reduce((acc, l) => acc.plus(l.haber).minus(l.debe), new Decimal(0));
    expect(er.resultadoEjercicio.toFixed(2)).toBe(esperado.toFixed(2));
  });

  it("egresos se exponen en positivo (montoExpuesto), ingresos/mixtos con signo", () => {
    const cmv = er.conceptos.find((c) => c.id === "COSTO_VENTAS")!;
    expect(cmv.total.toFixed(2)).toBe("-400.00");
    expect(cmv.montoExpuesto.toFixed(2)).toBe("400.00");
    const ventas = er.conceptos.find((c) => c.id === "INGRESOS_VENTAS")!;
    expect(ventas.montoExpuesto.toFixed(2)).toBe("1000.00");
    // Financieros netos (mixto) = 40 − 15 = 25, con signo.
    const fin = er.conceptos.find((c) => c.id === "RESULTADOS_FINANCIEROS")!;
    expect(fin.montoExpuesto.toFixed(2)).toBe("25.00");
  });
});

describe("cobertura del plan — toda cuenta de resultado mapea a un concepto", () => {
  it("ninguna analítica INGRESO/EGRESO del plan queda sin concepto", () => {
    const sinConcepto = PLAN_RT9.filter(
      (c) =>
        c.tipo === "ANALITICA" &&
        (categoriaPorClase(c.clase) === "INGRESO" || categoriaPorClase(c.clase) === "EGRESO") &&
        clasificarConceptoDRE(c.codigo, null) === null,
    ).map((c) => c.codigo);
    expect(sinConcepto).toEqual([]);
  });
});
