import "server-only";

import { type AsientoLineaDetalle, getAsientoDetalle } from "@/lib/actions/asientos";
import { type Decimal, toDecimal } from "@/lib/decimal";
import { EMBARQUE_CODIGOS } from "@/lib/services/cuenta-registry";
import {
  type MemoriaDespacho,
  type MemoriaDespachoCruzado,
  obtenerMemoriaDespacho,
} from "@/lib/services/despacho-memoria";
import type { CostoLandedResult } from "@/lib/services/despacho-parcial";

import type { DespachoFinanciero, DespachoVista } from "./despacho-vista";

/*
 * Proyección read-only de la pestaña Costos del despacho (PR-023b, CX-06).
 * DISPLAY-only: consume el agregado read-only `obtenerMemoriaDespacho` (que
 * envuelve el motor `calcularCostoLandedDespacho` SIN escribir — patrón
 * golden-testeado PR-023-pre, CRIT-05 caso a) + los valores STORED ya
 * mascarados de `DespachoFinanciero`. NUNCA llama al motor directo, NUNCA
 * recomputa el rateio, NUNCA escribe.
 *
 * Masking server-side (G-06/G-10): el caller (`page.tsx`) sólo invoca esta
 * proyección dentro de la rama `verCosto`; con `verCosto=false`/`financiero=null`
 * devuelve `null` ANTES de tocar la memoria → ningún valor de costo cruza al
 * cliente. El `kind` discrimina los 4 estados (oculto-por-permiso=`null` /
 * costos abiertos / legacy / cruzado) sin sobrecargar `null`.
 *
 * Tolerancia de consistencia (DISPLAY-only, no bloquea): ±ARS 0,01.
 */

const TOLERANCIA = toDecimal("0.01");

export type ClasificacionTributo = "CAPITALIZABLE" | "CREDITO_FISCAL" | "PERCEPCION_RECUPERABLE";

export type TributoRow = {
  label: string;
  valor: string;
  clasificacion: ClasificacionTributo;
};

export type ItemCostoRow = {
  itemDespachoId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  /** Costo landed UNITARIO (ARS, 4dp) — salida del motor. */
  costoUnitarioLanded: string;
  /** Costo total landed del ítem (ARS, 2dp). */
  costoTotal: string;
};

export type FacturaCostoRow = {
  id: number;
  proveedor: string;
  numero: string | null;
  momento: "ZONA_PRIMARIA" | "DESPACHO";
  totalArs: string;
  /** Sólo las DESPACHO capitalizan en el landed; las ZONA_PRIMARIA no. */
  capitalizable: boolean;
};

export type ComponentesCosto = {
  nacionalizado: string;
  tributosCapitalizables: string;
  facturasCapitalizables: string;
  capitalizables: string;
  total: string;
};

export type ResumenStored = {
  landedItemsTotal: string;
  tributosCapitalizables: string;
  tributosCashOut: string;
};

/**
 * Veredicto de consistencia — DISPLAY-only. Sólo cruza al cliente el `kind` y un
 * `delta` redondeado; jamás las líneas/`debe` crudos del asiento (anti-leak).
 */
export type ConsistenciaResultado =
  | { kind: "PREVIEW" } // BORRADOR: costo aún no persistido (camino "Simular")
  | { kind: "NO_APLICA" } // sin asiento/línea o estado no contabilizado
  | { kind: "CONSISTENTE"; delta: string }
  | { kind: "DISCREPANCIA"; delta: string };

export type Consistencia = {
  /** memoria ≡ costo persistido por ítem (= stock NACIONAL) — ancla golden #2. */
  persistido: ConsistenciaResultado;
  /** memoria ≡ DEBE mercadería del asiento — ancla golden #3. */
  asiento: ConsistenciaResultado;
};

export type CostosVista =
  | { kind: "COSTOS_ABIERTOS" }
  | { kind: "LEGACY"; resumen: ResumenStored; tributos: TributoRow[]; facturas: FacturaCostoRow[] }
  | {
      kind: "CRUZADO";
      estado: DespachoVista["estado"];
      baseRateio: "FOB" | "CANTIDAD";
      componentes: ComponentesCosto;
      items: ItemCostoRow[];
      tributos: TributoRow[];
      facturas: FacturaCostoRow[];
      consistencia: Consistencia;
    };

/** El throw conocido de `obtenerMemoriaDespacho` (costos sin cerrar) vs cualquier
 * otro error (p.ej. embarque faltante = integridad) que DEBE re-lanzarse. */
function esCostosAbiertos(e: unknown): boolean {
  return e instanceof Error && e.message.includes("no tiene costo FC");
}

function clasificarTributos(f: DespachoFinanciero): TributoRow[] {
  return [
    { label: "DIE", valor: f.die, clasificacion: "CAPITALIZABLE" },
    { label: "Tasa estadística", valor: f.tasaEstadistica, clasificacion: "CAPITALIZABLE" },
    { label: "Arancel SIM", valor: f.arancelSim, clasificacion: "CAPITALIZABLE" },
    { label: "IVA", valor: f.iva, clasificacion: "CREDITO_FISCAL" },
    { label: "IVA adicional", valor: f.ivaAdicional, clasificacion: "CREDITO_FISCAL" },
    { label: "IIBB", valor: f.iibb, clasificacion: "PERCEPCION_RECUPERABLE" },
    { label: "Ganancias", valor: f.ganancias, clasificacion: "PERCEPCION_RECUPERABLE" },
  ];
}

function mapFacturas(
  facturas: DespachoVista["facturas"],
  totalArsPorFactura: DespachoFinanciero["totalArsPorFactura"],
): FacturaCostoRow[] {
  return facturas.map((fa) => ({
    id: fa.id,
    proveedor: fa.proveedorNombre,
    numero: fa.facturaNumero,
    momento: fa.momento,
    totalArs: totalArsPorFactura[fa.id] ?? "0",
    capitalizable: fa.momento === "DESPACHO",
  }));
}

function mapPorItemRows(
  porItem: CostoLandedResult["porItem"],
  itemsById: Map<number, DespachoVista["items"][number]>,
): ItemCostoRow[] {
  return porItem.map((p) => {
    const it = itemsById.get(p.itemDespachoId);
    return {
      itemDespachoId: p.itemDespachoId,
      codigo: it?.productoCodigo ?? p.productoId,
      nombre: it?.productoNombre ?? "—",
      cantidad: p.cantidad,
      costoUnitarioLanded: p.costoUnitarioLandedArs.toFixed(4),
      costoTotal: p.costoTotalArs.toFixed(2),
    };
  });
}

/** A — memoria ≡ costo persistido por ítem (2dp ambos, robusto al redondeo). */
function evaluarConsistenciaPersistido(
  landed: CostoLandedResult,
  f: DespachoFinanciero,
  estado: DespachoVista["estado"],
): ConsistenciaResultado {
  if (estado === "BORRADOR") return { kind: "PREVIEW" }; // camino "Simular": aún no persiste
  if (estado !== "CONTABILIZADO") return { kind: "NO_APLICA" }; // ANULADO
  let maxDelta = toDecimal(0);
  for (const p of landed.porItem) {
    const stored = f.costoUnitarioPorItem[p.itemDespachoId];
    if (stored == null) continue;
    const d = p.costoUnitarioLandedArs.toDecimalPlaces(2).minus(toDecimal(stored)).abs();
    if (d.gt(maxDelta)) maxDelta = d;
  }
  const delta = maxDelta.toFixed(2);
  return maxDelta.lte(TOLERANCIA)
    ? { kind: "CONSISTENTE", delta }
    : { kind: "DISCREPANCIA", delta };
}

/** Σ `debe` de las líneas de la cuenta mercadería; `null` si no hay ninguna. */
function sumarDebeMercaderia(
  lineas: readonly AsientoLineaDetalle[],
  codigo: string,
): Decimal | null {
  let debe = toDecimal(0);
  let encontrada = false;
  for (const l of lineas) {
    if (l.cuentaCodigo !== codigo) continue;
    debe = debe.plus(toDecimal(l.debe));
    encontrada = true;
  }
  return encontrada ? debe : null;
}

/** B — memoria ≡ DEBE mercadería del asiento. CALL-only a getAsientoDetalle;
 * serializa sólo veredicto + delta (nunca el `debe` crudo). */
async function evaluarConsistenciaAsiento(
  landed: CostoLandedResult,
  asiento: DespachoVista["asiento"],
  estado: DespachoVista["estado"],
): Promise<ConsistenciaResultado> {
  if (estado !== "CONTABILIZADO" || !asiento) return { kind: "NO_APLICA" };
  const res = await getAsientoDetalle(asiento.id);
  if (!res.ok) return { kind: "NO_APLICA" };
  const debe = sumarDebeMercaderia(res.detalle.lineas, EMBARQUE_CODIGOS.MERCADERIAS.codigo);
  if (debe === null) return { kind: "NO_APLICA" };
  const diff = landed.costoTotalArs.minus(debe).abs();
  const delta = diff.toFixed(2);
  return diff.lte(TOLERANCIA) ? { kind: "CONSISTENTE", delta } : { kind: "DISCREPANCIA", delta };
}

async function buildCruzado(
  memoria: MemoriaDespachoCruzado,
  vista: DespachoVista,
  financiero: DespachoFinanciero,
  tributos: TributoRow[],
  facturas: FacturaCostoRow[],
): Promise<CostosVista> {
  const landed = memoria.landed;
  const itemsById = new Map(vista.items.map((i) => [i.id, i]));
  const componentes: ComponentesCosto = {
    nacionalizado: landed.nacionalizadoArs.toFixed(2),
    tributosCapitalizables: landed.tributosCapitalizablesArs.toFixed(2),
    facturasCapitalizables: landed.facturasCapitalizablesArs.toFixed(2),
    capitalizables: landed.capitalizablesArs.toFixed(2),
    total: landed.costoTotalArs.toFixed(2),
  };
  return {
    kind: "CRUZADO",
    estado: memoria.estado,
    baseRateio: memoria.baseRateio,
    componentes,
    items: mapPorItemRows(landed.porItem, itemsById),
    tributos,
    facturas,
    consistencia: {
      persistido: evaluarConsistenciaPersistido(landed, financiero, memoria.estado),
      asiento: await evaluarConsistenciaAsiento(landed, vista.asiento, memoria.estado),
    },
  };
}

/**
 * Proyección de la pestaña Costos. Read-only puro; gate único `VER_COSTO_LANDED`
 * resuelto por el caller y pasado como `verCosto`. Devuelve `null` cuando el
 * costo está oculto por permiso (ningún valor sensible se computa ni serializa).
 */
export async function proyectarCostos(
  despachoId: string,
  vista: DespachoVista,
  financiero: DespachoFinanciero | null,
  verCosto: boolean,
): Promise<CostosVista | null> {
  if (!verCosto || financiero === null) return null;

  let memoria: MemoriaDespacho | null;
  try {
    memoria = await obtenerMemoriaDespacho(despachoId);
  } catch (e) {
    if (esCostosAbiertos(e)) return { kind: "COSTOS_ABIERTOS" };
    throw e; // error de integridad (p.ej. embarque faltante): NO enmascarar
  }
  if (!memoria) return null;

  const tributos = clasificarTributos(financiero);
  const facturas = mapFacturas(vista.facturas, financiero.totalArsPorFactura);

  if (memoria.tipo === "LEGACY") {
    return {
      kind: "LEGACY",
      resumen: {
        landedItemsTotal: financiero.landedItemsTotal,
        tributosCapitalizables: financiero.tributosCapitalizables,
        tributosCashOut: financiero.tributosCashOut,
      },
      tributos,
      facturas,
    };
  }

  return buildCruzado(memoria, vista, financiero, tributos, facturas);
}
