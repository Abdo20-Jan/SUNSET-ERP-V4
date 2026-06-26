/**
 * Modelo unificado de la worklist Comercial > Documentos (PR-017 / COM-01).
 *
 * Funciones PURAS (sin DB, sin JSX): mapean `VentaRow` y `PedidoVentaRow` —los
 * shapes que YA devuelven los services de lectura existentes— a una fila común
 * `ComercialDocRow`, y los unen en una sola lista. Aislado del server action
 * (`@/lib/actions/comercial-documentos`) para poder testear el merge sin tocar
 * la base. Los `import type` se borran en compilación: este módulo no arrastra
 * los services "use server".
 */

import type { PedidoVentaRow } from "@/lib/actions/pedidos-venta";
import type { VentaRow } from "@/lib/actions/ventas";

export type DocumentoTipo = "VENTA" | "PEDIDO";

/** Fila unificada de la worklist comercial (derivable sólo de los services actuales). */
export type ComercialDocRow = {
  /** Clave única entre tipos (`venta-<id>` | `pedido-<id>`). */
  key: string;
  tipo: DocumentoTipo;
  /** Id original del documento (el id del pedido —number— se serializa a string). */
  id: string;
  numero: string;
  /** Ruta del record existente (drill-down vía EntityLink). */
  recordHref: string;
  /** Fecha de emisión (ISO). */
  fecha: string;
  /** Vencimiento (venta emitida) o fecha prevista (pedido); `null` si no aplica. */
  fechaRef: string | null;
  cliente: { id: string; nombre: string };
  /** Nombre achatado para quick-search / filtro / orden (los helpers comparan campos planos). */
  clienteNombre: string;
  moneda: "ARS" | "USD";
  /** Total en moneda nativa (string serializado). La presentación ARS/USD se resuelve en la celda. */
  total: string;
  /** Token de estado (enum de Venta o de Pedido). */
  estado: string;
  /** Cantidad de ítems (sólo pedidos; `null` en ventas). */
  itemsCount: number | null;
};

const VENTA_EMITIDA = "EMITIDA";
const ESTADOS_CANCELADOS = new Set(["CANCELADA", "CANCELADO"]);
// Documentos "cerrados" para la vista [Pendientes]: emitidos, completados o cancelados.
const ESTADOS_FINALIZADOS = new Set(["EMITIDA", "COMPLETADO", "CANCELADA", "CANCELADO"]);

export function ventaToDoc(v: VentaRow): ComercialDocRow {
  return {
    key: `venta-${v.id}`,
    tipo: "VENTA",
    id: v.id,
    numero: v.numero,
    recordHref: `/ventas/${v.id}`,
    fecha: v.fecha,
    // El vencimiento sólo es significativo en la factura emitida (las demás no lo muestran).
    fechaRef: v.estado === VENTA_EMITIDA ? v.fechaVencimiento : null,
    cliente: v.cliente,
    clienteNombre: v.cliente.nombre,
    moneda: v.moneda,
    total: v.total,
    estado: v.estado,
    itemsCount: null,
  };
}

export function pedidoToDoc(p: PedidoVentaRow): ComercialDocRow {
  return {
    key: `pedido-${p.id}`,
    tipo: "PEDIDO",
    id: String(p.id),
    numero: p.numero,
    recordHref: `/ventas/pedidos/${p.id}`,
    fecha: p.fecha,
    fechaRef: p.fechaPrevista,
    cliente: p.cliente,
    clienteNombre: p.cliente.nombre,
    moneda: p.moneda,
    total: p.total,
    estado: p.estado,
    itemsCount: p.itemsCount,
  };
}

/**
 * Une ventas + pedidos en la lista comercial unificada, ordenada por fecha de
 * emisión descendente (documento más reciente primero). Pura: no toca DB.
 */
export function mergeComercialDocumentos(
  ventas: readonly VentaRow[],
  pedidos: readonly PedidoVentaRow[],
): ComercialDocRow[] {
  const docs = [...ventas.map(ventaToDoc), ...pedidos.map(pedidoToDoc)];
  docs.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return docs;
}

// ── Predicados de vistas salvas (puros) ──────────────────────────────────────

export function esBorrador(d: ComercialDocRow): boolean {
  return d.estado === "BORRADOR";
}

export function esCancelado(d: ComercialDocRow): boolean {
  return ESTADOS_CANCELADOS.has(d.estado);
}

/** Documento vivo aún no finalizado (ni emitido/completado ni cancelado). */
export function esPendiente(d: ComercialDocRow): boolean {
  return !ESTADOS_FINALIZADOS.has(d.estado);
}
