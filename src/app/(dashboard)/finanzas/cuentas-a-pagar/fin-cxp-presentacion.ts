/**
 * Helpers PUROS de presentación de la worklist de gestión de cuentas a pagar
 * (FIN-02 · PR-026). Client-safe y sin JSX — importable tanto desde la page
 * RSC como desde los componentes client y la export action (idioma de
 * `tesoreria/cuentas-a-cobrar/cuentas-a-cobrar-presentacion.ts`, PR-025c).
 *
 * READ-ONLY: proyecta (aplana) lo que el motor de aging YA devuelve —
 * `SaldoProveedorAging.facturas` anidadas → 1 fila por documento pendiente.
 * CERO queries nuevas y CERO re-derivación de aging: `bucket`,
 * `diasParaVencer` y `montoNativo` vienen clasificados del servicio
 * (`getSaldosPorProveedorConAging`, 5 capas — jamás se reconstruye acá).
 * La conservación exacta de filas (cada factura UNA vez) y la paridad de
 * totales con `aging-presentacion` están trabadas por test
 * (`test/fin-cxp-worklist.test.ts`).
 *
 * Shapes client-safe: duplicatas estructuralmente idénticas a los DTOs del
 * servicio `cuentas-a-pagar.ts` (server-only, no importable desde "use
 * client" — precedente 025b/025c). No se reusa la variante de
 * `saldos-proveedores-columns.tsx` porque ésta OMITE `referencia` (esa grid
 * no la exhibía; esta vista de gestión sí), ni el `FacturaPendiente` local de
 * `pago-por-factura.tsx` (no tiene `montoNativo`). Extender el DTO del
 * servicio = extender acá también.
 */

export type FacturaPendiente = {
  origen: "compra" | "embarque" | "gasto";
  id: string;
  numero: string;
  referencia: string | null; // código de embarque / OC / número interno del gasto
  fecha: string;
  fechaVencimiento: string | null;
  diasParaVencer: number | null; // negativo = vencida hace N días
  bucket: "vencida" | "proxima" | "al_dia" | "sin_fecha";
  monto: string; // ARS (legado)
  montoNativo: string; // pendiente en la moneda NATIVA del documento
  moneda: string;
};

export type SaldoProveedorAging = {
  proveedorId: string;
  proveedorNombre: string;
  cuit: string | null;
  pais: string;
  cuentaContableId: number | null;
  saldoTotal: string; // ARS contable — la verdad
  saldoTotalUsd?: string; // USD nativo — para displays
  vencido: string;
  proximo: string;
  alDia: string;
  facturas: FacturaPendiente[];
};

/**
 * Fila del grid: un documento pendiente + campos del proveedor para búsqueda
 * (top-level — `quickSearch`/chips del grid leen `row[key]`) + el padre
 * COMPLETO por referencia (CTA `pagarHref` verbatim + drill-down del expand,
 * sin re-armar objetos parciales).
 */
export type FacturaPendienteFlatRow = FacturaPendiente & {
  proveedorNombre: string;
  cuit: string | null;
  proveedor: SaldoProveedorAging;
};

/**
 * Id de fila: mismo criterio que `facturaKey` (pago-por-factura.tsx, 025b-2) —
 * `origen-id`. Los ids de compra/gasto son uuid y los de EmbarqueCosto
 * numéricos; el prefijo de origen evita cualquier colisión entre tablas.
 * (Duplicado mínimo deliberado: importar la función runtime desde ese módulo
 * "use client" la volvería client-reference al usarla en la page RSC.)
 */
export function finCxpRowId(f: Pick<FacturaPendiente, "origen" | "id">): string {
  return `${f.origen}-${f.id}`;
}

/**
 * Aplana el aging anidado en 1 fila por documento pendiente, en el ORDEN
 * NATURAL del servicio (proveedores por vencido desc, facturas por
 * diasParaVencer asc) — o sea, contiguo por proveedor. No agrega ni
 * recalcula: cada factura aparece EXACTAMENTE una vez.
 */
export function flattenFacturasPendientes(
  proveedores: SaldoProveedorAging[],
): FacturaPendienteFlatRow[] {
  return proveedores.flatMap((p) =>
    p.facturas.map((f) => ({
      ...f,
      proveedorNombre: p.proveedorNombre,
      cuit: p.cuit,
      proveedor: p,
    })),
  );
}

/**
 * Orden default de la vista de gestión: urgencia (diasParaVencer asc,
 * sin fecha al final). Presentación pura — mismas filas, mismos totales.
 */
export function ordenarPorUrgencia<T extends Pick<FacturaPendiente, "diasParaVencer">>(
  rows: T[],
): T[] {
  return [...rows].sort(porUrgencia);
}

function porUrgencia(
  a: Pick<FacturaPendiente, "diasParaVencer">,
  b: Pick<FacturaPendiente, "diasParaVencer">,
): number {
  if (a.diasParaVencer === null && b.diasParaVencer === null) return 0;
  if (a.diasParaVencer === null) return 1;
  if (b.diasParaVencer === null) return -1;
  return a.diasParaVencer - b.diasParaVencer;
}

// Sub-vistas oficiales = presets de URL server-side (lección PR-010; espejo
// del `?filtro=vencidas` de 025b/c). Filtran sobre la clasificación YA hecha
// por el motor (bucket / diasParaVencer) — nunca re-derivan aging.
// [Promesas]/[A reconocer]/[Programados] etc. NO tienen backing model —
// FIN-03/FIN-04 (omitidas, no fabricadas).
export type FinVista = "todas" | "hoy" | "prox7" | "vencidas";

export function resolverVista(param: string | undefined): FinVista {
  if (param === "hoy" || param === "prox7" || param === "vencidas") return param;
  return "todas";
}

export function filtrarPorVista<T extends Pick<FacturaPendiente, "bucket" | "diasParaVencer">>(
  rows: T[],
  vista: FinVista,
): T[] {
  if (vista === "hoy") return rows.filter((r) => r.diasParaVencer === 0);
  if (vista === "prox7") return rows.filter((r) => r.bucket === "proxima");
  if (vista === "vencidas") return rows.filter((r) => r.bucket === "vencida");
  return rows;
}

// Presentación del bucket — VERBATIM de `cuentas-a-cobrar-columns.tsx` (025c,
// mapas no exportados allí). Estado = derivado del bucket del motor; los 10
// estados de la spec FIN-02 no tienen backing model (FIN-03/FIN-04).
export const BUCKET_LABEL: Record<FacturaPendiente["bucket"], string> = {
  vencida: "Vencida",
  proxima: "Próxima",
  al_dia: "Al día",
  sin_fecha: "—",
};

export const BUCKET_CLASS: Record<FacturaPendiente["bucket"], string> = {
  vencida:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  proxima:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  al_dia:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  sin_fecha: "border-muted bg-muted/50 text-muted-foreground",
};

/**
 * URL del CTA "Pagar" — VERBATIM de `PagarSoloCell`
 * (`saldos-proveedores-columns.tsx`, PR-025b): link pre-llenado al flujo
 * EXISTENTE de movimientos, por PROVEEDOR (cuenta contable + saldo contable
 * total). Este PR no agrega mutación alguna; la identidad de la URL está
 * trabada por test.
 */
export function pagarHref(
  p: Pick<SaldoProveedorAging, "cuentaContableId" | "saldoTotal" | "proveedorNombre" | "facturas">,
): string {
  if (!p.cuentaContableId) return "/tesoreria/movimientos/nuevo?tipo=PAGO";
  const params = new URLSearchParams({
    tipo: "PAGO",
    cuentaContableId: String(p.cuentaContableId),
    monto: p.saldoTotal,
    descripcion: `Pago a ${p.proveedorNombre}${
      p.facturas.length > 0 ? ` — ${p.facturas.length} factura(s)` : ""
    }`,
  });
  return `/tesoreria/movimientos/nuevo?${params.toString()}`;
}
