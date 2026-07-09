/**
 * Helpers PUROS de presentación de la worklist canónica de compras (facturas
 * de proveedor). Client-safe y sin JSX — importable desde la page RSC, los
 * componentes client y la export action (idioma de `fin-cxc-presentacion.ts`,
 * PR-026).
 *
 * READ-ONLY: proyecta (aplana) lo que `listarCompras` YA devuelve — proveedor
 * anidado → campos top-level (la búsqueda rápida del grid lee `row[key]`) —
 * e inyecta el vínculo OC↔factura resuelto por el caller (queries acotadas a
 * la página cargada; acá NO hay I/O). CERO re-derivación: montos, fechas y
 * estados viajan tal cual del action.
 */

import type { CompraEstado, Moneda } from "@/generated/prisma/client";
import type { CompraRow } from "@/lib/actions/compras";

/** Vínculo mínimo a la OC de origen (cierra el ciclo OC↔factura). */
export type PedidoVinculo = { id: number; numero: string };

/**
 * Fila del grid: una compra con proveedor aplanado (búsqueda rápida top-level)
 * + el vínculo a la OC de origen (`null` cuando la factura no nació de una OC).
 */
export type CompraWorklistRow = {
  id: string;
  numero: string;
  fecha: string;
  fechaVencimiento: string | null;
  proveedorId: string;
  proveedorNombre: string;
  moneda: Moneda;
  total: string;
  estado: CompraEstado;
  pedido: PedidoVinculo | null;
};

/**
 * Aplana las filas de `listarCompras` en el shape del grid, en el ORDEN
 * NATURAL del action (createdAt desc). Cada compra aparece EXACTAMENTE una
 * vez; el pedido se resuelve por lookup (compraId → OC) sin recalcular nada.
 */
export function flattenCompras(
  rows: CompraRow[],
  pedidoPorCompra: ReadonlyMap<string, PedidoVinculo>,
): CompraWorklistRow[] {
  return rows.map((r) => flattenCompra(r, pedidoPorCompra));
}

// Helper nombrado (sin ternarios en el object literal — gotcha Lizard).
function flattenCompra(
  r: CompraRow,
  pedidoPorCompra: ReadonlyMap<string, PedidoVinculo>,
): CompraWorklistRow {
  const pedido = pedidoPorCompra.get(r.id) ?? null;
  return {
    id: r.id,
    numero: r.numero,
    fecha: r.fecha,
    fechaVencimiento: r.fechaVencimiento,
    proveedorId: r.proveedor.id,
    proveedorNombre: r.proveedor.nombre,
    moneda: r.moneda,
    total: r.total,
    estado: r.estado,
    pedido,
  };
}
