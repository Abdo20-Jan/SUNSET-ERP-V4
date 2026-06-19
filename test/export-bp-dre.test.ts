import { describe, expect, it } from "vitest";

import { Decimal } from "@/lib/decimal";
import {
  type ImpuestoLeafInput,
  agruparImpuestosDRE,
  construirModeloDRE,
} from "@/lib/services/reportes/export/balance-bp-dre";
import type { ConceptoDRE } from "@/lib/services/reportes/estado-resultados-rt9";

// `magnitud` = valor natural do conceito (ingreso/custo em positivo). Reproduz a
// convenção real do RT9: total = contribuição ASSINADA (egreso negativo);
// montoExpuesto = magnitude (egreso = |total|).
function cuenta(
  id: ConceptoDRE["id"],
  label: string,
  tipo: Exclude<ConceptoDRE["tipo"], "subtotal">,
  magnitud: number,
): ConceptoDRE {
  const mag = new Decimal(magnitud);
  const total = tipo === "egreso" ? mag.negated() : mag;
  return {
    id,
    label,
    tipo,
    enfasis: false,
    total,
    montoExpuesto: tipo === "egreso" ? total.negated() : total,
  };
}

function subtotal(
  id: ConceptoDRE["id"],
  label: string,
  acumulado: number,
  enfasis = false,
): ConceptoDRE {
  const t = new Decimal(acumulado);
  return { id, label, tipo: "subtotal", enfasis, total: t, montoExpuesto: t };
}

// Cascada mínima: Ventas 1000 − Costo 600 = Bruto 400 − Ganancias 40 = 360.
function conceptosFixture(): ConceptoDRE[] {
  return [
    cuenta("INGRESOS_VENTAS", "Ingresos por ventas", "ingreso", 1000),
    subtotal("INGRESOS_NETOS", "Ingresos netos", 1000),
    cuenta("COSTO_VENTAS", "Costo de ventas", "egreso", 600),
    subtotal("RESULTADO_BRUTO", "Resultado bruto", 400, true),
    cuenta("IMPUESTO_GANANCIAS", "Impuesto a las ganancias", "egreso", 40),
    subtotal("RESULTADO_EJERCICIO", "Resultado del ejercicio", 360, true),
  ];
}

describe("construirModeloDRE", () => {
  it("mapeia a cascata em linhas (USD = ARS ÷ TC); egreso lê-se negativo", () => {
    const m = construirModeloDRE(conceptosFixture(), [], "10");
    const ventas = m.lineas.find((l) => l.label === "Ingresos por ventas");
    expect(ventas?.ars).toBe("1000.00");
    expect(ventas?.usd).toBe("100.00");
    const costo = m.lineas.find((l) => l.label === "Costo de ventas");
    expect(costo?.ars).toBe("-600.00"); // egreso negativo
    expect(costo?.tipo).toBe("egreso");
  });

  it("resultado vem da linha RESULTADO_EJERCICIO da cascata (flag esResultado)", () => {
    const m = construirModeloDRE(conceptosFixture(), [], "10");
    expect(m.resultadoArs).toBe("360.00");
    expect(m.resultadoUsd).toBe("36.00");
    const res = m.lineas.find((l) => l.esResultado);
    expect(res?.label).toBe("Resultado del ejercicio");
    expect(m.lineas.filter((l) => l.esResultado)).toHaveLength(1);
  });

  it("valores ASSINADOS: SUM das linhas-conta = resultado (fórmula viva correta)", () => {
    const m = construirModeloDRE(conceptosFixture(), [], "10");
    const somaContas = m.lineas
      .filter((l) => l.tipo !== "subtotal")
      .reduce((acc, l) => acc.plus(new Decimal(l.ars)), new Decimal(0));
    expect(somaContas.toFixed(2)).toBe(m.resultadoArs); // 1000 + (−600) + (−40) = 360
  });

  it("preserva flags subtotal/enfasis", () => {
    const m = construirModeloDRE(conceptosFixture(), [], "10");
    const bruto = m.lineas.find((l) => l.label === "Resultado bruto");
    expect(bruto?.tipo).toBe("subtotal");
    expect(bruto?.enfasis).toBe(true);
  });

  it("sem TC: USD = passthrough do ARS", () => {
    const m = construirModeloDRE(conceptosFixture(), [], null);
    expect(m.lineas.find((l) => l.label === "Ingresos por ventas")?.usd).toBe("1000.00");
    expect(m.resultadoUsd).toBe("360.00");
  });
});

const impuestos: ImpuestoLeafInput[] = [
  { codigo: "6.5.01", montoArs: "100.00" }, // IIBB
  { codigo: "6.5.02", montoArs: "50.00" }, // tasas municipales → mesmo grupo
  { codigo: "9.6.01", montoArs: "30.00" }, // Ley 25.413
  { codigo: "8.9.01", montoArs: "40.00" }, // ganancias
  { codigo: "7.2.06", montoArs: "0.00" }, // aduaneros zero → omitido
  { codigo: "6.1.99", montoArs: "999.00" }, // prefixo não-imposto → ignorado
];

describe("agruparImpuestosDRE", () => {
  it("agrupa por grupo AR, soma, converte e omite zero/desconhecido", () => {
    const d = agruparImpuestosDRE(impuestos, "10");
    const ventas = d.find((g) => g.grupo.startsWith("Impuestos sobre ventas"));
    expect(ventas?.ars).toBe("150.00"); // 100 + 50
    expect(ventas?.usd).toBe("15.00");
    expect(d.find((g) => g.grupo === "Impuesto a las ganancias")?.ars).toBe("40.00");
    expect(d.find((g) => g.grupo.startsWith("Impuestos financieros"))?.ars).toBe("30.00");
    // aduaneros 0 omitido; 6.1.99 ignorado (não é conta de imposto)
    expect(d.some((g) => g.grupo.startsWith("Derechos/honorarios aduaneros"))).toBe(false);
  });

  it("respeita a ordem de GRUPOS_IMPUESTO_DRE", () => {
    const d = agruparImpuestosDRE(impuestos, "10");
    const idxVentas = d.findIndex((g) => g.grupo.startsWith("Impuestos sobre ventas"));
    const idxGanancias = d.findIndex((g) => g.grupo === "Impuesto a las ganancias");
    const idxFin = d.findIndex((g) => g.grupo.startsWith("Impuestos financieros"));
    expect(idxVentas).toBeLessThan(idxGanancias);
    expect(idxGanancias).toBeLessThan(idxFin);
  });

  it("totaliza os impostos no modelo DRE", () => {
    const m = construirModeloDRE(conceptosFixture(), impuestos, "10");
    expect(m.totalImpuestosArs).toBe("220.00"); // 150 + 40 + 30
    expect(m.totalImpuestosUsd).toBe("22.00");
  });
});
