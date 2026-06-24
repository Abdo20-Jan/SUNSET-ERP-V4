// Bloco "Conferindo o DRE" para o export do Balanço (formato artesanal do dono):
// a cascata RT9 do Estado de Resultados (mesma ordem do ORDEN EECC, já em
// taxonomia argentina) renderizada em USD+ARS, + um detalhe dos IMPOSTOS de
// resultado (IIBB/tasas, cargas sociais, aduaneros, ganancias, Ley 25.413,
// sellos). É um cross-check: o RESULTADO DEL EJERCICIO do DRE bate por
// construção com o do PL do Balanço (mesma fonte = razão).
//
// Módulo PURO (sem DB / sem server-only) → testável com fixtures. O IVA NÃO
// entra aqui: na Argentina é conta de balanço (crédito/débito fiscal), não
// linha de resultado.

import { Decimal, sumMoney } from "@/lib/decimal";
import { convertirAUsd } from "@/lib/format";

import type { ConceptoDRE, ConceptoDREId } from "../estado-resultados-rt9";

export type LineaDRE = {
  id: ConceptoDREId;
  label: string;
  tipo: "ingreso" | "egreso" | "mixto" | "subtotal";
  enfasis: boolean;
  esResultado: boolean; // true só na linha RESULTADO_EJERCICIO (referência da conferência)
  usd: string; // toFixed(2) — valor ASSINADO (egreso negativo)
  ars: string; // toFixed(2)
};

export type DetalleImpuestoBP = {
  grupo: string;
  usd: string;
  ars: string;
};

export type ModeloDRE = {
  lineas: LineaDRE[];
  impuestos: DetalleImpuestoBP[];
  totalImpuestosUsd: string;
  totalImpuestosArs: string;
  resultadoUsd: string;
  resultadoArs: string;
};

// Subconjunto da conta de imposto agregada (debe/haber do período) que o serviço
// (dre-impuestos.ts) entrega. `montoArs` = custo do período (debe − haber).
export type ImpuestoLeafInput = {
  codigo: string;
  montoArs: string;
};

// Grupos de impostos de RESULTADO (taxonomia AR), na ordem da cascata. Cada
// conta cai no primeiro grupo cujo prefixo casa (prefixos disjuntos). Exportado
// para o serviço saber quais contas consultar (fonte única, evita drift).
export const GRUPOS_IMPUESTO_DRE: readonly { grupo: string; prefijos: readonly string[] }[] = [
  { grupo: "Impuestos sobre ventas (IIBB, tasas)", prefijos: ["6.5"] },
  { grupo: "Cargas sociales (SUSS)", prefijos: ["6.1.04", "7.1.04"] },
  { grupo: "Derechos/honorarios aduaneros (no capitalizables)", prefijos: ["7.2.06"] },
  { grupo: "Tasas societarias (IGJ/DPPJ)", prefijos: ["7.8.01"] },
  { grupo: "Impuesto a las ganancias", prefijos: ["8.9"] },
  { grupo: "Impuestos financieros (Ley 25.413, sellos)", prefijos: ["9.6"] },
];

/** Prefixos de todas as contas de imposto de resultado (para o serviço). */
export const PREFIJOS_IMPUESTO_DRE: readonly string[] = GRUPOS_IMPUESTO_DRE.flatMap(
  (g) => g.prefijos,
);

function casaPrefijo(codigo: string, prefijo: string): boolean {
  return codigo === prefijo || codigo.startsWith(`${prefijo}.`);
}

function grupoDeCodigo(codigo: string): string | null {
  for (const g of GRUPOS_IMPUESTO_DRE) {
    if (g.prefijos.some((p) => casaPrefijo(codigo, p))) return g.grupo;
  }
  return null;
}

/**
 * Agrupa os impostos de resultado por grupo AR e converte (ARS nativo do razão;
 * USD = ARS ÷ TC). Emite só grupos com valor ≠ 0, na ordem de GRUPOS_IMPUESTO_DRE.
 */
export function agruparImpuestosDRE(
  leaves: ImpuestoLeafInput[],
  tc: string | null,
): DetalleImpuestoBP[] {
  const porGrupo = new Map<string, Decimal[]>();
  for (const l of leaves) {
    const grupo = grupoDeCodigo(l.codigo);
    if (!grupo) continue;
    const arr = porGrupo.get(grupo) ?? [];
    arr.push(new Decimal(l.montoArs));
    porGrupo.set(grupo, arr);
  }

  const out: DetalleImpuestoBP[] = [];
  for (const { grupo } of GRUPOS_IMPUESTO_DRE) {
    const montos = porGrupo.get(grupo);
    if (!montos) continue;
    const ars = sumMoney(montos);
    if (ars.isZero()) continue;
    const arsStr = ars.toFixed(2);
    out.push({ grupo, ars: arsStr, usd: convertirAUsd(arsStr, tc) });
  }
  return out;
}

/**
 * Monta o modelo do bloco DRE a partir da cascata RT9 (`conceptos`) + os
 * impostos de resultado já consultados. Cada linha usa `total` ASSINADO (a
 * contribuição ao resultado: ingreso +, egreso −, mixto/subtotal com sinal) —
 * NÃO `montoExpuesto` (magnitude). Assim os egresos saem negativos e um SUM
 * simples das linhas dá o resultado correto (fórmulas vivas no Excel). USD = ARS ÷ TC.
 */
export function construirModeloDRE(
  conceptos: ConceptoDRE[],
  impuestosLeaves: ImpuestoLeafInput[],
  tc: string | null,
): ModeloDRE {
  const lineas: LineaDRE[] = conceptos.map((c) => {
    const ars = c.total.toFixed(2);
    return {
      id: c.id,
      label: c.label,
      tipo: c.tipo,
      enfasis: c.enfasis,
      esResultado: c.id === "RESULTADO_EJERCICIO",
      ars,
      usd: convertirAUsd(ars, tc),
    };
  });

  const resultadoConcepto = conceptos.find((c) => c.id === "RESULTADO_EJERCICIO");
  const resultadoArs = (resultadoConcepto?.total ?? new Decimal(0)).toFixed(2);

  const impuestos = agruparImpuestosDRE(impuestosLeaves, tc);
  const totalImpuestosArs = sumMoney(impuestos.map((i) => new Decimal(i.ars))).toFixed(2);

  return {
    lineas,
    impuestos,
    totalImpuestosArs,
    totalImpuestosUsd: convertirAUsd(totalImpuestosArs, tc),
    resultadoArs,
    resultadoUsd: convertirAUsd(resultadoArs, tc),
  };
}
