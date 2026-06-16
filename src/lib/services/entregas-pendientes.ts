// Resumen puro del pendiente de entrega de una venta (stock-dual W3).
//
// Dado los items de una venta con su cantidad vendida y la ya entregada
// (suma de ItemEntrega de remitos no anulados), calcula cuántas unidades
// quedan pendientes de despacho. El pendiente se clampa por item: un item
// entregado de más no compensa el pendiente de otro item.

export type ItemPendienteInput = {
  vendido: number;
  entregado: number;
};

export type ResumenPendiente = {
  unidadesVendidas: number;
  unidadesEntregadas: number;
  unidadesPendientes: number;
  tienePendiente: boolean;
};

export function resumenPendienteVenta(items: ItemPendienteInput[]): ResumenPendiente {
  let unidadesVendidas = 0;
  let unidadesEntregadas = 0;
  let unidadesPendientes = 0;
  for (const it of items) {
    unidadesVendidas += it.vendido;
    unidadesEntregadas += Math.max(0, it.entregado);
    unidadesPendientes += Math.max(0, it.vendido - it.entregado);
  }
  return {
    unidadesVendidas,
    unidadesEntregadas,
    unidadesPendientes,
    tienePendiente: unidadesPendientes > 0,
  };
}
