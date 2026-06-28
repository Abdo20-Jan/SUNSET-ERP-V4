import type { EmbarqueCostoDetalle, EmbarqueDetalle } from "@/lib/actions/embarques";
import type { ContenedorPackingDTO } from "@/lib/services/contenedor";

/*
 * Proyección server-side del embarque para las read-views del Record (PR-021,
 * CX-03). Separa lo NO sensible (`EmbarqueVista`, siempre enviado) del bloque de
 * costo/landed (`EmbarqueFinanciero`, sólo cuando `verCosto`) — la máscara real
 * de CRIT-10/G-10 vive acá, en la frontera server→client: cuando falta
 * `costos.verLanded` el objeto financiero es `null` y los campos de costo NUNCA
 * cruzan a las read-views (ni FOB, ni CIF, ni tributos, ni costo unitario por ítem,
 * ni las facturas de costo). El `PermissionGate`/condicional en el FE es sólo
 * reflejo de UX.
 *
 * NOTA: el form de edición (EmbarqueForm, hospedado en la FloatingWorkWindow)
 * recibe el `EmbarqueDetalle` COMPLETO porque lo necesita para editar — esa
 * exposición es preexistente (el antiguo `[id]/page.tsx` ya pasaba todo al form)
 * y queda fuera de alcance (cambiarla exigiría tocar el form/loader, prohibido).
 * Estas proyecciones sólo blindan las superficies de LECTURA nuevas.
 *
 * Puro DISPLAY: copia/omite campos ya calculados; no recalcula NADA (CRIT-04/05).
 */

export type EmbarqueVista = {
  id: string;
  codigo: string;
  estado: EmbarqueDetalle["estado"];
  moneda: EmbarqueDetalle["moneda"];
  tipoCambio: string;
  proveedorId: string;
  proveedorNombre: string;
  incoterm: EmbarqueDetalle["incoterm"];
  lugarIncoterm: string | null;
  nombreBuque: string | null;
  lineaMaritima: string | null;
  fechaEmpaque: string | null;
  fechaSalida: string | null;
  lugarTransbordo: string | null;
  fechaTransbordo: string | null;
  fechaLlegada: string | null;
  diasPagoDespuesLlegada: number | null;
  asiento: EmbarqueDetalle["asiento"];
  asientoZonaPrimaria: EmbarqueDetalle["asientoZonaPrimaria"];
  despachosActivosCount: number;
  /** Sólo cantidad (no el precio FOB unitario, que es costo). */
  items: Array<{ id: number; productoId: string; cantidad: number }>;
  totalCantidad: number;
};

export type EmbarqueFinanciero = {
  moneda: EmbarqueDetalle["moneda"];
  tipoCambio: string;
  fobTotal: string;
  cifTotal: string;
  valorFleteOrigen: string | null;
  valorSeguroOrigen: string | null;
  /** Capitalizables al costo (CRIT-09). */
  die: string;
  tasaEstadistica: string;
  arancelSim: string;
  /** Cash-out / crédito recuperable — NO costo del producto (CRIT-09). */
  iva: string;
  ivaAdicional: string;
  iibb: string;
  ganancias: string;
  costoTotal: string;
  itemsFob: Array<{ productoId: string; cantidad: number; precioUnitarioFob: string }>;
  costos: EmbarqueCostoDetalle[];
};

export type ContenedorVista = {
  id: string;
  numeroContenedor: string;
  tipo: string | null;
  numeroBL: string | null;
  numeroHBL: string | null;
  estado: ContenedorPackingDTO["estado"];
  items: Array<{
    id: number;
    productoId: string;
    cantidadDeclarada: number;
    pesoUnitarioKg: string | null;
    ncm: string | null;
    paisOrigen: string | null;
    loteFabricacion: string | null;
  }>;
};

export function proyectarEmbarque(
  e: EmbarqueDetalle,
  proveedorNombre: string,
  verCosto: boolean,
): { vista: EmbarqueVista; financiero: EmbarqueFinanciero | null } {
  const vista: EmbarqueVista = {
    id: e.id,
    codigo: e.codigo,
    estado: e.estado,
    moneda: e.moneda,
    tipoCambio: e.tipoCambio,
    proveedorId: e.proveedorId,
    proveedorNombre,
    incoterm: e.incoterm,
    lugarIncoterm: e.lugarIncoterm,
    nombreBuque: e.nombreBuque,
    lineaMaritima: e.lineaMaritima,
    fechaEmpaque: e.fechaEmpaque,
    fechaSalida: e.fechaSalida,
    lugarTransbordo: e.lugarTransbordo,
    fechaTransbordo: e.fechaTransbordo,
    fechaLlegada: e.fechaLlegada,
    diasPagoDespuesLlegada: e.diasPagoDespuesLlegada,
    asiento: e.asiento,
    asientoZonaPrimaria: e.asientoZonaPrimaria,
    despachosActivosCount: e.despachosActivosCount,
    items: e.items.map((it) => ({ id: it.id, productoId: it.productoId, cantidad: it.cantidad })),
    totalCantidad: e.items.reduce((acc, it) => acc + it.cantidad, 0),
  };

  if (!verCosto) return { vista, financiero: null };

  const financiero: EmbarqueFinanciero = {
    moneda: e.moneda,
    tipoCambio: e.tipoCambio,
    fobTotal: e.fobTotal,
    cifTotal: e.cifTotal,
    valorFleteOrigen: e.valorFleteOrigen,
    valorSeguroOrigen: e.valorSeguroOrigen,
    die: e.die,
    tasaEstadistica: e.tasaEstadistica,
    arancelSim: e.arancelSim,
    iva: e.iva,
    ivaAdicional: e.ivaAdicional,
    iibb: e.iibb,
    ganancias: e.ganancias,
    costoTotal: e.costoTotal,
    itemsFob: e.items.map((it) => ({
      productoId: it.productoId,
      cantidad: it.cantidad,
      precioUnitarioFob: it.precioUnitarioFob,
    })),
    costos: e.costos,
  };
  return { vista, financiero };
}

export function proyectarContenedores(contenedores: ContenedorPackingDTO[]): ContenedorVista[] {
  // El packing list trae `costoFCUnitario` (costo) por línea; lo omitimos siempre
  // en la read-view de Containers (la valorización vive en la matriz del form).
  return contenedores.map((c) => ({
    id: c.id,
    numeroContenedor: c.numeroContenedor,
    tipo: c.tipo,
    numeroBL: c.numeroBL,
    numeroHBL: c.numeroHBL,
    estado: c.estado,
    items: c.items.map((it) => ({
      id: it.id,
      productoId: it.productoId,
      cantidadDeclarada: it.cantidadDeclarada,
      pesoUnitarioKg: it.pesoUnitarioKg,
      ncm: it.ncm,
      paisOrigen: it.paisOrigen,
      loteFabricacion: it.loteFabricacion,
    })),
  }));
}

/*
 * Contadores fiscales del bloque Despachos (§9.8-9.10): cantidades, NO costo.
 * Total declarado vs nacionalizado (despachos CONTABILIZADO) vs en despacho
 * (BORRADOR) vs en fiscal (remanente en zona primaria). Es conteo de cantidades
 * leído de los despachos — no toca el motor de rateio.
 */
export type FiscalCounters = {
  totalDeclarado: number;
  nacionalizado: number;
  enDespacho: number;
  enFiscal: number;
};

export function calcularFiscalCounters(
  totalDeclarado: number,
  despachos: Array<{ estado: "BORRADOR" | "CONTABILIZADO" | "ANULADO"; cantidad: number }>,
): FiscalCounters {
  let nacionalizado = 0;
  let enDespacho = 0;
  for (const d of despachos) {
    if (d.estado === "CONTABILIZADO") nacionalizado += d.cantidad;
    else if (d.estado === "BORRADOR") enDespacho += d.cantidad;
  }
  const enFiscal = Math.max(0, totalDeclarado - nacionalizado - enDespacho);
  return { totalDeclarado, nacionalizado, enDespacho, enFiscal };
}
