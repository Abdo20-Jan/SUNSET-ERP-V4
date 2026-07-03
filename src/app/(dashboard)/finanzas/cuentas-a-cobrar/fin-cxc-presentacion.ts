/**
 * Helpers PUROS de presentación de la worklist de gestión de cuentas a cobrar
 * (FIN-01 · PR-026). Client-safe y sin JSX — importable tanto desde la page
 * RSC como desde los componentes client y la export action (idioma de
 * `tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-presentacion.ts`, PR-025c).
 *
 * READ-ONLY: proyecta (aplana) lo que el motor de aging YA devuelve —
 * `SaldoClienteAging.ventas` anidadas → 1 fila por venta pendiente. CERO
 * queries nuevas y CERO re-derivación de aging: `bucket`, `diasParaVencer` y
 * `montoNativo` vienen clasificados del servicio
 * (`getSaldosPorClienteConAging`). La conservación exacta de filas (cada
 * venta UNA vez) y la paridad de totales con `aging-presentacion` están
 * trabadas por test (`test/fin-cxc-worklist.test.ts`).
 *
 * Los shapes se REUSAN de `cuentas-a-cobrar-presentacion.ts` (025c, módulo
 * puro compartido — de ahí también viene `cobrarHref`, el CTA verbatim).
 * `ordenarPorUrgencia`/vistas/`BUCKET_*` se duplican deliberadamente respecto
 * de `fin-cxp-presentacion.ts`: las dos rebanadas FIN-01/FIN-02 no comparten
 * archivos (corte limpio del split de contingencia PR-026a/b).
 */

import type {
  SaldoClienteAgingRow,
  VentaPendienteRow,
} from "../../tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-presentacion";

export type { SaldoClienteAgingRow, VentaPendienteRow };

/**
 * Fila del grid: una venta pendiente + campos del cliente para búsqueda
 * (top-level — `quickSearch` del grid lee `row[key]`) + el padre COMPLETO por
 * referencia (CTA `cobrarHref` verbatim + drill-down del expand con la
 * `VentasPendientesTable` reusada de 025c, sin re-armar objetos parciales).
 */
export type VentaPendienteFlatRow = VentaPendienteRow & {
  clienteNombre: string;
  cuit: string | null;
  cliente: SaldoClienteAgingRow;
};

/**
 * Aplana el aging anidado en 1 fila por venta pendiente, en el ORDEN NATURAL
 * del servicio (clientes por saldo desc, ventas por diasParaVencer asc) — o
 * sea, contiguo por cliente (es el orden del preset `?agrupar=cliente`). No
 * agrega ni recalcula: cada venta aparece EXACTAMENTE una vez.
 */
export function flattenVentasPendientes(clientes: SaldoClienteAgingRow[]): VentaPendienteFlatRow[] {
  return clientes.flatMap((c) =>
    c.ventas.map((v) => ({
      ...v,
      clienteNombre: c.clienteNombre,
      cuit: c.cuit,
      cliente: c,
    })),
  );
}

/**
 * Orden default de la vista de gestión: urgencia (diasParaVencer asc,
 * sin fecha al final). Presentación pura — mismas filas, mismos totales
 * (trabado por test: mismo multiset de ids que el flatten).
 */
export function ordenarPorUrgencia<T extends Pick<VentaPendienteRow, "diasParaVencer">>(
  rows: T[],
): T[] {
  return [...rows].sort(porUrgencia);
}

function porUrgencia(
  a: Pick<VentaPendienteRow, "diasParaVencer">,
  b: Pick<VentaPendienteRow, "diasParaVencer">,
): number {
  if (a.diasParaVencer === null && b.diasParaVencer === null) return 0;
  if (a.diasParaVencer === null) return 1;
  if (b.diasParaVencer === null) return -1;
  return a.diasParaVencer - b.diasParaVencer;
}

// Sub-vistas oficiales = presets de URL server-side (lección PR-010; espejo
// del `?filtro=vencidas` de 025b/c). Filtran sobre la clasificación YA hecha
// por el motor (bucket / diasParaVencer) — nunca re-derivan aging.
// [Promesas]/[A reconocer]/[En cobranza] etc. NO tienen backing model —
// FIN-03 (omitidas, no fabricadas).
export type FinVista = "todas" | "hoy" | "prox7" | "vencidas";

export function resolverVista(param: string | undefined): FinVista {
  if (param === "hoy" || param === "prox7" || param === "vencidas") return param;
  return "todas";
}

export function filtrarPorVista<T extends Pick<VentaPendienteRow, "bucket" | "diasParaVencer">>(
  rows: T[],
  vista: FinVista,
): T[] {
  if (vista === "hoy") return rows.filter((r) => r.diasParaVencer === 0);
  if (vista === "prox7") return rows.filter((r) => r.bucket === "proxima");
  if (vista === "vencidas") return rows.filter((r) => r.bucket === "vencida");
  return rows;
}

// Presentación del bucket — VERBATIM de `cuentas-a-cobrar-columns.tsx` (025c,
// mapas no exportados allí). Estado = derivado del bucket del motor; los 9
// estados de la spec FIN-01 no tienen backing model (FIN-03).
export const BUCKET_LABEL: Record<VentaPendienteRow["bucket"], string> = {
  vencida: "Vencida",
  proxima: "Próxima",
  al_dia: "Al día",
  sin_fecha: "—",
};

export const BUCKET_CLASS: Record<VentaPendienteRow["bucket"], string> = {
  vencida:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  proxima:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  al_dia:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  sin_fecha: "border-muted bg-muted/50 text-muted-foreground",
};
