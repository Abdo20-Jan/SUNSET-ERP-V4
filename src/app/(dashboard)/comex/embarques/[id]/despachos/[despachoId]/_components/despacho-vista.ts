import { toDecimal } from "@/lib/decimal";
import type { DespachoDetalle } from "@/lib/actions/despachos";

/*
 * Proyección server-side del despacho para la read-view del Record (PR-023a,
 * CX-05). Espeja `embarque-vista.ts` (PR-021): separa lo NO sensible
 * (`DespachoVista`, siempre enviado) del bloque de costo/tributos
 * (`DespachoFinanciero`, sólo cuando `verCosto`). La máscara real de
 * CRIT-10/G-10 vive acá, en la frontera server→client: cuando falta
 * `costos.verLanded` el objeto financiero es `null` y los campos de costo
 * NUNCA cruzan al cliente (ni costo unitario por ítem, ni los 8 tributos, ni
 * el total ARS por factura). El condicional en el FE es sólo reflejo de UX.
 *
 * Puro DISPLAY: copia campos ya almacenados y agrega sumas de presentación
 * (Σ costoUnitario × cantidad, subtotales de tributos). NO recalcula el costo
 * landed — nunca llama al motor `calcularCostoLandedDespacho` (CRIT-04/05). Las
 * sumas son agregados de visualización sobre valores STORED, como el `fobTotal`
 * del header del embarque.
 */

export type DespachoVista = {
  id: string;
  codigo: string;
  fecha: string;
  estado: "BORRADOR" | "CONTABILIZADO" | "ANULADO";
  numeroOM: string | null;
  itemsCount: number;
  facturasCount: number;
  asiento: { id: string; numero: number } | null;
  embarqueId: string;
  embarqueCodigo: string;
  notas: string | null;
  /** Sólo cantidades (no el costo unitario FC, que es costo → financiero). */
  items: Array<{
    id: number;
    productoId: string;
    productoCodigo: string;
    productoNombre: string;
    cantidad: number;
    cantidadEmbarque: number;
  }>;
  /** Sin `totalArs` (es costo → financiero). */
  facturas: Array<{
    id: number;
    proveedorNombre: string;
    facturaNumero: string | null;
    momento: "ZONA_PRIMARIA" | "DESPACHO";
  }>;
};

export type DespachoFinanciero = {
  tipoCambio: string;
  /** Capitalizables al costo (CRIT-09). */
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  /** Cash-out / crédito recuperable — NO costo del producto (CRIT-06/09). */
  iva: string;
  ivaAdicional: string;
  iibb: string;
  ganancias: string;
  /** Costo unitario FC por ítem (id del ItemDespacho → costo STORED). */
  costoUnitarioPorItem: Record<number, string>;
  /** Total ARS por factura (id de la factura → total STORED). */
  totalArsPorFactura: Record<number, string>;
  /** Σ costoUnitario × cantidad — agregado de DISPLAY sobre valores STORED. */
  landedItemsTotal: string;
  /** DIE + Tasa estadística + Arancel SIM (capitalizables al costo). */
  tributosCapitalizables: string;
  /** IVA + IVA adicional + IIBB + Ganancias (cash-out / crédito, NO costo). */
  tributosCashOut: string;
};

export function proyectarDespacho(
  d: DespachoDetalle,
  verCosto: boolean,
): { vista: DespachoVista; financiero: DespachoFinanciero | null } {
  const vista: DespachoVista = {
    id: d.id,
    codigo: d.codigo,
    fecha: d.fecha,
    estado: d.estado,
    numeroOM: d.numeroOM,
    itemsCount: d.itemsCount,
    facturasCount: d.facturasCount,
    asiento: d.asiento,
    embarqueId: d.embarqueId,
    embarqueCodigo: d.embarqueCodigo,
    notas: d.notas,
    items: d.items.map((i) => ({
      id: i.id,
      productoId: i.productoId,
      productoCodigo: i.productoCodigo,
      productoNombre: i.productoNombre,
      cantidad: i.cantidad,
      cantidadEmbarque: i.cantidadEmbarque,
    })),
    facturas: d.facturas.map((f) => ({
      id: f.id,
      proveedorNombre: f.proveedorNombre,
      facturaNumero: f.facturaNumero,
      momento: f.momento,
    })),
  };

  if (!verCosto) return { vista, financiero: null };

  const costoUnitarioPorItem: Record<number, string> = {};
  let landed = toDecimal(0);
  for (const i of d.items) {
    costoUnitarioPorItem[i.id] = i.costoUnitario;
    landed = landed.plus(toDecimal(i.costoUnitario).times(i.cantidad));
  }
  const totalArsPorFactura: Record<number, string> = {};
  for (const f of d.facturas) totalArsPorFactura[f.id] = f.totalArs;

  const capitalizables = toDecimal(d.die)
    .plus(toDecimal(d.tasaEstadistica))
    .plus(toDecimal(d.arancelSim));
  const cashOut = toDecimal(d.iva)
    .plus(toDecimal(d.ivaAdicional))
    .plus(toDecimal(d.iibb))
    .plus(toDecimal(d.ganancias));

  const financiero: DespachoFinanciero = {
    tipoCambio: d.tipoCambio,
    die: d.die,
    tasaEstadistica: d.tasaEstadistica,
    arancelSim: d.arancelSim,
    iva: d.iva,
    ivaAdicional: d.ivaAdicional,
    iibb: d.iibb,
    ganancias: d.ganancias,
    costoUnitarioPorItem,
    totalArsPorFactura,
    landedItemsTotal: landed.toDecimalPlaces(2).toString(),
    tributosCapitalizables: capitalizables.toDecimalPlaces(2).toString(),
    tributosCashOut: cashOut.toDecimalPlaces(2).toString(),
  };
  return { vista, financiero };
}
