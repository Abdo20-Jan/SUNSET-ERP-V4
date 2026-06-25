import "server-only";

import { puedeVerCosto, puedeVerMargen } from "@/lib/permisos-masking";
import type { MargenesDimensionales } from "@/lib/services/bi";
import type { AnalisisLucro } from "@/lib/services/bi-lucro";
import type { LucroIndicadores, LucroInputs } from "@/lib/services/bi-lucro-formulas";

/**
 * Strip de la pestaña BI · rentabilidad (PR-011). Toma la salida YA computada de
 * `getAnalisisLucro` (no toca `bi.ts`/`bi-lucro.ts`/`estado-resultados.ts`) y
 * omite los campos sensibles en la frontera del server component:
 *  - sin `margenes.ver` ⇒ indicadores → null, inputs (salvo `ventas`) → null,
 *    todas las series/rankings de margen → [].
 *  - con margen pero sin `costos.ver` ⇒ se ocultan sólo las columnas de costo
 *    unitario crudo (precioVsCosto, vendidosBajoCosto).
 * `inputs.ventas` (ingresos) NO es sensible → se conserva para la fila
 * "Ingresos netos" de la cascada.
 */

export type IndicadoresMaybe = {
  [K in keyof LucroIndicadores]: LucroIndicadores[K] | null;
};

export type InputsMaybe = {
  ventas: number;
  resultadoBruto: number | null;
  ebit: number | null;
  depreciacionAmortizacion: number | null;
  resultadoNeto: number | null;
};

export type AnalisisLucroMasked = {
  indicadores: IndicadoresMaybe;
  inputs: InputsMaybe;
  dimensionales: MargenesDimensionales;
};

/** Indicadores de margen → todos null. Complejidad 1. */
function nullIndicadores(): IndicadoresMaybe {
  return {
    margenBruto: null,
    margenBrutoPct: null,
    ebit: null,
    margenOperativoPct: null,
    ebitda: null,
    margenEbitdaPct: null,
    resultadoNeto: null,
    margenNetoPct: null,
  };
}

/** Inputs → sólo `ventas` (los demás son resultado contable sensible). Complejidad 1. */
function stripInputs(i: LucroInputs): InputsMaybe {
  return {
    ventas: i.ventas,
    resultadoBruto: null,
    ebit: null,
    depreciacionAmortizacion: null,
    resultadoNeto: null,
  };
}

/** Dimensionales sin nada de margen (todas las series/rankings vacías). Complejidad 1. */
function emptyDimensionales(): MargenesDimensionales {
  return {
    margenPorCanal: [],
    margenPorMarca: [],
    precioVsCosto: [],
    margenBrutoMensal: [],
    topProductosMargen: [],
    vendidosBajoCosto: [],
  };
}

/** Mantiene márgenes, oculta sólo las columnas de costo unitario crudo. Complejidad 1. */
function stripCostoCols(d: MargenesDimensionales): MargenesDimensionales {
  return { ...d, precioVsCosto: [], vendidosBajoCosto: [] };
}

export async function stripAnalisisLucro(raw: AnalisisLucro): Promise<AnalisisLucroMasked> {
  const [verMargen, verCosto] = await Promise.all([puedeVerMargen(), puedeVerCosto()]);

  if (!verMargen) {
    return {
      indicadores: nullIndicadores(),
      inputs: stripInputs(raw.inputs),
      dimensionales: emptyDimensionales(),
    };
  }

  const dimensionales = verCosto ? raw.dimensionales : stripCostoCols(raw.dimensionales);
  return { indicadores: raw.indicadores, inputs: raw.inputs, dimensionales };
}
