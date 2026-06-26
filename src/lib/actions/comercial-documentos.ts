"use server";

/**
 * Read aggregator de la worklist Comercial > Documentos (PR-017 / COM-01).
 *
 * SÓLO LECTURA: reusa los services existentes `listarVentas` / `listarPedidosVenta`
 * sin modificarlos y los une con la función pura `mergeComercialDocumentos`. No
 * toca schema, motores ni actions de escritura. El merge/map vive en
 * `@/lib/comercial/documentos` (testeable sin DB).
 */

import { listarPedidosVenta } from "@/lib/actions/pedidos-venta";
import { listarVentas, type VentaRow } from "@/lib/actions/ventas";
import {
  type ComercialDocRow,
  esCancelado,
  mergeComercialDocumentos,
} from "@/lib/comercial/documentos";

// `listarVentas` topea en 500 filas por página; iteramos para no truncar la lista.
const VENTAS_PAGE_SIZE = 500;

async function listarTodasLasVentas(incluirCanceladas: boolean): Promise<VentaRow[]> {
  const primera = await listarVentas({ page: 1, perPage: VENTAS_PAGE_SIZE, incluirCanceladas });
  const rows = [...primera.rows];
  const totalPaginas = Math.ceil(primera.total / VENTAS_PAGE_SIZE);
  for (let page = 2; page <= totalPaginas; page++) {
    const siguiente = await listarVentas({ page, perPage: VENTAS_PAGE_SIZE, incluirCanceladas });
    rows.push(...siguiente.rows);
  }
  return rows;
}

/**
 * Lista unificada de documentos comerciales (Pedidos + Ventas), ordenada por
 * fecha desc. `incluirCanceladas` aplica a AMBOS tipos: cuando es false se
 * excluyen ventas canceladas (vía service) y pedidos cancelados (vía filtro
 * post-merge), para que el toggle sea coherente en toda la worklist.
 */
export async function listarComercialDocumentos(opts?: {
  incluirCanceladas?: boolean;
}): Promise<ComercialDocRow[]> {
  const incluirCanceladas = opts?.incluirCanceladas ?? false;
  const [ventas, pedidos] = await Promise.all([
    listarTodasLasVentas(incluirCanceladas),
    listarPedidosVenta(),
  ]);
  const docs = mergeComercialDocumentos(ventas, pedidos);
  return incluirCanceladas ? docs : docs.filter((d) => !esCancelado(d));
}
