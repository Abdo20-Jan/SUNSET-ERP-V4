/**
 * Estado de Resultados en el orden de exposición de los EECC (etapa 2).
 *
 * Módulo PURO (sin `server-only` ni DB): recibe las cuentas analíticas de
 * resultado ya agregadas (debe/haber del período) y arma la cascada de los 21
 * conceptos del `ORDEN EECC.xlsx` (+ "Otros ingresos operativos", que el dueño
 * expone dentro de Ingresos netos = 22 líneas en total):
 *
 *   Ingresos por ventas
 *   (−) Deducciones sobre ventas
 *   Otros ingresos operativos
 *   = Ingresos netos
 *   (−) Costo de ventas
 *   = Resultado bruto
 *   (−) Gastos de comercialización
 *   (−) Gastos de administración
 *   (−) Otros gastos operativos
 *   ± Cambios en propiedades de inversión / Pérdidas y reversión de desvaloriz.
 *   ± Resultados financieros y de tenencia
 *   + Otros ingresos / (−) Otros egresos
 *   ± Resultados por venta y baja de activos / Contingencias
 *   (−) Multas, sanciones y penalidades
 *   = Resultado antes del impuesto a las ganancias
 *   (−) Impuesto a las ganancias
 *   = Resultado de operaciones que continúan
 *   ± Resultado neto de operaciones discontinuadas
 *   = Resultado del ejercicio
 *
 * La contribución de cada cuenta al resultado es `haber − debe` (positivo =
 * aumenta la ganancia), lo que netea regularizadoras (deducciones, RECPAM) y
 * resultados mixtos sin mirar su naturaleza. El concepto de cada cuenta se
 * deriva del `rubroEECC` (que MANDA) o, en su defecto, del prefijo de código
 * (equivalente: `rubroEECC` se deriva del mismo prefijo en `orden-eecc.ts`).
 *
 * El orden de exposición y los rótulos de los rubros viven en `orden-eecc.ts`.
 */

import { Decimal } from "@/lib/decimal";
import { RUBRO_RESULTADO_POR_PREFIJO } from "../orden-eecc";

/** Id estable de cada concepto de la cascada (21 del Excel + Otros ingresos
 * operativos, que el dueño expone dentro de Ingresos netos). */
export type ConceptoDREId =
  | "INGRESOS_VENTAS"
  | "DEDUCCIONES"
  | "OTROS_INGRESOS_OPERATIVOS"
  | "INGRESOS_NETOS"
  | "COSTO_VENTAS"
  | "RESULTADO_BRUTO"
  | "GASTOS_COMERCIALIZACION"
  | "GASTOS_ADMINISTRACION"
  | "OTROS_GASTOS_OPERATIVOS"
  | "CAMBIOS_PROP_INVERSION"
  | "PERDIDAS_DESVALORIZACION"
  | "RESULTADOS_FINANCIEROS"
  | "OTROS_INGRESOS"
  | "OTROS_EGRESOS"
  | "RESULTADO_VENTA_BAJA_ACTIVOS"
  | "CONTINGENCIAS"
  | "MULTAS_SANCIONES"
  | "RESULTADO_ANTES_IMPUESTO"
  | "IMPUESTO_GANANCIAS"
  | "RESULTADO_OPERACIONES_CONTINUAN"
  | "RESULTADO_OPERACIONES_DISCONTINUADAS"
  | "RESULTADO_EJERCICIO";

/** Cómo se expone el monto y cómo contribuye al resultado. */
export type ConceptoTipo = "ingreso" | "egreso" | "mixto" | "subtotal";

type ConceptoCuentaDef = {
  kind: "cuenta";
  id: ConceptoDREId;
  label: string;
  tipo: Exclude<ConceptoTipo, "subtotal">;
  /** Rubro EECC de sus cuentas (== `rubroEECC`, `orden-eecc.ts`). Manda sobre
   * el código a la hora de clasificar. */
  rubro: string;
  /** Prefijos de sub/clase de código (fallback cuando no hay rubro). */
  prefijos: string[];
};
type ConceptoSubtotalDef = {
  kind: "subtotal";
  id: ConceptoDREId;
  label: string;
  enfasis?: boolean;
};
type ConceptoDef = ConceptoCuentaDef | ConceptoSubtotalDef;

// Cascada en el orden del Excel. Los subtotales son snapshots del acumulado:
// cada subtotal = suma de las contribuciones de todos los conceptos-cuenta que
// vienen antes. Así Resultado del ejercicio = Σ(haber − debe) de todas.
const ESTRUCTURA_DRE: readonly ConceptoDef[] = [
  {
    kind: "cuenta",
    id: "INGRESOS_VENTAS",
    label: "Ingresos por ventas",
    tipo: "ingreso",
    rubro: "Ingresos por ventas",
    prefijos: ["4.1"],
  },
  {
    kind: "cuenta",
    id: "DEDUCCIONES",
    label: "Deducciones sobre ventas",
    tipo: "egreso",
    rubro: "Deducciones sobre ventas",
    prefijos: ["4.2"],
  },
  {
    kind: "cuenta",
    id: "OTROS_INGRESOS_OPERATIVOS",
    label: "Otros ingresos operativos",
    tipo: "ingreso",
    rubro: "Otros ingresos operativos",
    prefijos: ["4.3"],
  },
  { kind: "subtotal", id: "INGRESOS_NETOS", label: "Ingresos netos" },
  {
    kind: "cuenta",
    id: "COSTO_VENTAS",
    label: "Costo de ventas",
    tipo: "egreso",
    rubro: "Costo de ventas",
    prefijos: ["5"],
  },
  { kind: "subtotal", id: "RESULTADO_BRUTO", label: "Resultado bruto" },
  {
    kind: "cuenta",
    id: "GASTOS_COMERCIALIZACION",
    label: "Gastos de comercialización",
    tipo: "egreso",
    rubro: "Gastos de comercialización",
    prefijos: ["6"],
  },
  {
    kind: "cuenta",
    id: "GASTOS_ADMINISTRACION",
    label: "Gastos de administración",
    tipo: "egreso",
    rubro: "Gastos de administración",
    prefijos: ["7"],
  },
  {
    kind: "cuenta",
    id: "OTROS_GASTOS_OPERATIVOS",
    label: "Otros gastos operativos",
    tipo: "egreso",
    rubro: "Otros gastos operativos",
    prefijos: ["8.0"],
  },
  {
    kind: "cuenta",
    id: "CAMBIOS_PROP_INVERSION",
    label: "Cambios en propiedades de inversión",
    tipo: "mixto",
    rubro: "Cambios en propiedades de inversión",
    prefijos: ["8.1"],
  },
  {
    kind: "cuenta",
    id: "PERDIDAS_DESVALORIZACION",
    label: "Pérdidas y reversión de desvalorizaciones",
    tipo: "mixto",
    rubro: "Pérdidas y reversión de desvalorizaciones",
    prefijos: ["8.2"],
  },
  {
    kind: "cuenta",
    id: "RESULTADOS_FINANCIEROS",
    label: "Resultados financieros y de tenencia",
    tipo: "mixto",
    rubro: "Resultados financieros y de tenencia",
    prefijos: ["9"],
  },
  {
    kind: "cuenta",
    id: "OTROS_INGRESOS",
    label: "Otros ingresos",
    tipo: "ingreso",
    rubro: "Otros ingresos",
    prefijos: ["8.3"],
  },
  {
    kind: "cuenta",
    id: "OTROS_EGRESOS",
    label: "Otros egresos",
    tipo: "egreso",
    rubro: "Otros egresos",
    prefijos: ["8.4"],
  },
  {
    kind: "cuenta",
    id: "RESULTADO_VENTA_BAJA_ACTIVOS",
    label: "Resultados por venta y baja de activos",
    tipo: "mixto",
    rubro: "Resultados por venta y baja de activos",
    prefijos: ["8.5"],
  },
  {
    kind: "cuenta",
    id: "CONTINGENCIAS",
    label: "Contingencias",
    tipo: "mixto",
    rubro: "Contingencias",
    prefijos: ["8.6"],
  },
  {
    kind: "cuenta",
    id: "MULTAS_SANCIONES",
    label: "Multas, sanciones y penalidades",
    tipo: "egreso",
    rubro: "Multas, sanciones y penalidades",
    prefijos: ["8.7"],
  },
  {
    kind: "subtotal",
    id: "RESULTADO_ANTES_IMPUESTO",
    label: "Resultado antes del impuesto a las ganancias",
  },
  {
    kind: "cuenta",
    id: "IMPUESTO_GANANCIAS",
    label: "Impuesto a las ganancias",
    tipo: "egreso",
    rubro: "Impuesto a las ganancias",
    prefijos: ["8.9"],
  },
  {
    kind: "subtotal",
    id: "RESULTADO_OPERACIONES_CONTINUAN",
    label: "Resultado de operaciones que continúan",
  },
  {
    kind: "cuenta",
    id: "RESULTADO_OPERACIONES_DISCONTINUADAS",
    label: "Resultado neto de operaciones discontinuadas",
    tipo: "mixto",
    rubro: "Resultado neto de operaciones discontinuadas",
    prefijos: ["8.8"],
  },
  { kind: "subtotal", id: "RESULTADO_EJERCICIO", label: "Resultado del ejercicio", enfasis: true },
];

const CUENTA_DEFS = ESTRUCTURA_DRE.filter((d): d is ConceptoCuentaDef => d.kind === "cuenta");
const CONCEPTO_POR_RUBRO = new Map(CUENTA_DEFS.map((d) => [d.rubro, d.id]));

/**
 * Cuenta analítica de resultado ya agregada para el período. `rubroEECC`
 * (cuando viene) manda sobre el código a la hora de elegir el concepto.
 */
export type LeafResultado = {
  codigo: string;
  categoria: "INGRESO" | "EGRESO";
  rubroEECC: string | null;
  debe: Decimal;
  haber: Decimal;
};

/**
 * Concepto de la cascada para una cuenta. `rubroEECC` manda; si no, se deriva
 * del prefijo de código. Devuelve null si nada matchea (un subtotal no es
 * destino de cuentas). El guard del plan exige cobertura total.
 */
export function clasificarConceptoDRE(
  codigo: string,
  rubroEECC?: string | null,
): ConceptoDREId | null {
  if (rubroEECC) {
    const porRubro = CONCEPTO_POR_RUBRO.get(rubroEECC);
    if (porRubro) return porRubro;
  }
  for (const d of CUENTA_DEFS) {
    if (d.prefijos.some((p) => codigo === p || codigo.startsWith(`${p}.`))) {
      return d.id;
    }
  }
  return null;
}

export type ConceptoDRE = {
  id: ConceptoDREId;
  label: string;
  tipo: ConceptoTipo;
  enfasis: boolean;
  /** Contribución al resultado con signo (+ aumenta la ganancia). Para los
   * subtotales, el acumulado de la cascada hasta esa línea. */
  total: Decimal;
  /** Magnitud para exhibición. Egreso: el opuesto de `total` (positivo, se lee
   * como resta). Ingreso/mixto/subtotal: igual a `total` (con signo). */
  montoExpuesto: Decimal;
};

export type EstadoResultadosRT9 = {
  conceptos: ConceptoDRE[];
  resultadoEjercicio: Decimal;
};

/**
 * Arma la cascada del Estado de Resultados desde las cuentas agregadas. La
 * contribución de cada cuenta es `haber − debe`; los subtotales son snapshots
 * del acumulado, de modo que Resultado del ejercicio = Σ(haber − debe).
 */
export function construirEstadoResultadosRT9(leaves: LeafResultado[]): EstadoResultadosRT9 {
  const totalPorConcepto = new Map<ConceptoDREId, Decimal>();
  for (const d of CUENTA_DEFS) totalPorConcepto.set(d.id, new Decimal(0));

  for (const l of leaves) {
    const id = clasificarConceptoDRE(l.codigo, l.rubroEECC);
    if (!id) continue;
    const contribucion = l.haber.minus(l.debe);
    totalPorConcepto.set(id, (totalPorConcepto.get(id) ?? new Decimal(0)).plus(contribucion));
  }

  let acumulado = new Decimal(0);
  const conceptos: ConceptoDRE[] = ESTRUCTURA_DRE.map((d) => {
    if (d.kind === "cuenta") {
      const total = totalPorConcepto.get(d.id) ?? new Decimal(0);
      acumulado = acumulado.plus(total);
      const totalR = total.toDecimalPlaces(2);
      const montoExpuesto = d.tipo === "egreso" ? totalR.negated() : totalR;
      return {
        id: d.id,
        label: d.label,
        tipo: d.tipo,
        enfasis: false,
        total: totalR,
        montoExpuesto,
      };
    }
    const valor = acumulado.toDecimalPlaces(2);
    return {
      id: d.id,
      label: d.label,
      tipo: "subtotal" as const,
      enfasis: Boolean(d.enfasis),
      total: valor,
      montoExpuesto: valor,
    };
  });

  return { conceptos, resultadoEjercicio: acumulado.toDecimalPlaces(2) };
}

// Guard interno: cada concepto-cuenta declara un rubro que existe en el orden
// de exposición de los EECC (evita drift entre la cascada y `orden-eecc.ts`).
const _RUBROS_RESULTADO = new Set(RUBRO_RESULTADO_POR_PREFIJO.map((r) => r.rubro));
for (const d of CUENTA_DEFS) {
  if (!_RUBROS_RESULTADO.has(d.rubro)) {
    throw new Error(`Concepto DRE "${d.id}" referencia un rubro inexistente: "${d.rubro}"`);
  }
}
