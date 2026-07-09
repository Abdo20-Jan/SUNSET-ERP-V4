/**
 * Helpers PUROS de presentación de la worklist de pedidos de compra (OC)
 * (COMP-01 · PR-029). Client-safe y sin JSX — importable tanto desde la page
 * RSC como desde los componentes client y la export action (idioma de
 * `fin-cxc-presentacion.ts`, PR-026).
 *
 * READ-ONLY: proyecta (aplana) lo que `listarPedidosCompra` YA devuelve —
 * `proveedor.{id,nombre}` a campos top-level (la búsqueda rápida del grid lee
 * `row[key]`) — e inyecta `comprasCount` desde el groupBy de compras
 * vinculadas que la page/export corren aparte. CERO queries y CERO
 * re-derivación acá. Las sub-vistas oficiales son presets de URL server-side
 * (lección PR-010) sobre el `estado` del pedido.
 */

import type { Moneda, PedidoEstado } from "@/generated/prisma/client";
import type { PedidoCompraRow } from "@/lib/actions/pedidos-compra";

/** Fila del grid: pedido aplanado + nº de compras vinculadas (EMITIDA/RECIBIDA). */
export type PedidoCompraWorklistRow = {
  id: number;
  numero: string;
  fecha: string;
  fechaPrevista: string | null;
  proveedorId: string;
  proveedorNombre: string;
  moneda: Moneda;
  total: string;
  estado: PedidoEstado;
  itemsCount: number;
  comprasCount: number;
};

/**
 * Aplana los pedidos (1:1, mismo orden del servicio — createdAt desc) e
 * inyecta el conteo de compras vinculadas (`?? 0` cuando el pedido no tiene
 * ninguna). No agrega ni recalcula nada.
 */
export function flattenPedidos(
  rows: PedidoCompraRow[],
  comprasPorPedido: ReadonlyMap<number, number>,
): PedidoCompraWorklistRow[] {
  return rows.map((p) => ({
    id: p.id,
    numero: p.numero,
    fecha: p.fecha,
    fechaPrevista: p.fechaPrevista,
    proveedorId: p.proveedor.id,
    proveedorNombre: p.proveedor.nombre,
    moneda: p.moneda,
    total: p.total,
    estado: p.estado,
    itemsCount: p.itemsCount,
    comprasCount: comprasPorPedido.get(p.id) ?? 0,
  }));
}

// Sub-vistas oficiales = presets de URL server-side (espejo FIN-01): filtran
// por el `estado` del pedido, nunca re-derivan nada.
export type PedidosCompraVista = "todas" | "abiertas" | "completadas" | "canceladas";

export const VISTA_LABELS: Record<PedidosCompraVista, string> = {
  todas: "Todas",
  abiertas: "Abiertas",
  completadas: "Completadas",
  canceladas: "Canceladas",
};

export function resolverVista(param: string | undefined): PedidosCompraVista {
  if (param === "abiertas" || param === "completadas" || param === "canceladas") return param;
  return "todas";
}

// "Abierto" = todavía puede generar compras (todo lo que no está COMPLETADO
// ni CANCELADO). Literales tipados contra el enum — sin import de valor del
// client de Prisma en un módulo client-safe.
const ESTADOS_ABIERTOS: ReadonlyArray<PedidoEstado> = [
  "BORRADOR",
  "ENVIADO",
  "CONFIRMADO",
  "PARCIAL",
];

function esAbierto(estado: PedidoEstado): boolean {
  return ESTADOS_ABIERTOS.includes(estado);
}

function esCompletado(estado: PedidoEstado): boolean {
  return estado === "COMPLETADO";
}

function esCancelado(estado: PedidoEstado): boolean {
  return estado === "CANCELADO";
}

export function filtrarPorVista<T extends Pick<PedidoCompraWorklistRow, "estado">>(
  rows: T[],
  vista: PedidosCompraVista,
): T[] {
  if (vista === "abiertas") return rows.filter((r) => esAbierto(r.estado));
  if (vista === "completadas") return rows.filter((r) => esCompletado(r.estado));
  if (vista === "canceladas") return rows.filter((r) => esCancelado(r.estado));
  return rows;
}
