import Decimal from "decimal.js";

import { calcularRateioEmbarque, type CostoLogisticoInput } from "./comex";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type SimulacionInput = {
  moneda: "ARS" | "USD";
  tipoCambio: Decimal.Value;
  valorFleteOrigen?: Decimal.Value | null;
  valorSeguroOrigen?: Decimal.Value | null;
  die: Decimal.Value;
  tasaEstadistica: Decimal.Value;
  arancelSim: Decimal.Value;
  iva: Decimal.Value;
  ivaAdicional: Decimal.Value;
  ganancias: Decimal.Value;
  iibb: Decimal.Value;
  items: ReadonlyArray<{
    productoId?: string | null;
    descripcionLibre?: string | null;
    label?: string | null;
    cantidad: number;
    precioUnitarioFob: Decimal.Value;
    precioVentaUnitario?: Decimal.Value | null;
  }>;
  costos: ReadonlyArray<{
    tipo?: string;
    descripcion?: string | null;
    subtotal: Decimal.Value;
    moneda: "ARS" | "USD";
    tipoCambio: Decimal.Value;
  }>;
};

export type ItemRentabilidad = {
  index: number;
  productoId: string | null;
  descripcion: string | null;
  cantidad: number;
  precioUnitarioFob: Decimal;
  fobItem: Decimal;
  costoTotalArs: Decimal;
  costoUnitarioArs: Decimal;
  precioVentaUnitarioArs: Decimal | null;
  // Rentabilidad = (precioVenta - costoUnitario) / costoUnitario × 100
  margenUnitarioArs: Decimal | null;
  margenPorcentaje: Decimal | null;
  ingresoTotalArs: Decimal | null;
  utilidadTotalArs: Decimal | null;
};

export type ResumenSimulacion = {
  // Subtotales en ARS (todos convertidos al TC correspondiente)
  fobTotal: Decimal; // en moneda del embarque
  fobTotalArs: Decimal;
  fleteOrigenArs: Decimal;
  seguroOrigenArs: Decimal;
  cifTotalArs: Decimal;
  costosLogisticosArs: Decimal;
  // Tributos aduaneros rateables (en ARS)
  dieArs: Decimal;
  tasaEstadisticaArs: Decimal;
  arancelSimArs: Decimal;
  tributosRateablesArs: Decimal;
  // Créditos fiscales (NO se ratean al costo del producto, recuperables)
  ivaArs: Decimal;
  ivaAdicionalArs: Decimal;
  gananciasArs: Decimal;
  iibbArs: Decimal;
  creditosFiscalesArs: Decimal;
  // Costo total nacionalizado (rateable) = FOB + origen + costos + tributos rateables
  costoTotalNacionalizadoArs: Decimal;
  // Salida total de caja estimada = costo nacionalizado + créditos fiscales
  desembolsoTotalEstimadoArs: Decimal;
  // Por línea
  items: ItemRentabilidad[];
  // Métricas agregadas de rentabilidad (sólo considera líneas con precioVenta cargado)
  itemsConPrecio: number;
  costoSubtotalConPrecioArs: Decimal;
  ingresoTotalArs: Decimal;
  utilidadTotalArs: Decimal;
  margenPromedioPorcentaje: Decimal | null;
};

const TWO_DP = 2;

function toDec(v: Decimal.Value | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(v.toString());
}

function round2(v: Decimal): Decimal {
  return v.toDecimalPlaces(TWO_DP, Decimal.ROUND_HALF_UP);
}

/**
 * Calcula el resumen completo de una simulación: prorrateo del costo
 * nacionalizado a cada item y, si hay precio de venta cargado, la
 * rentabilidad unitaria y total.
 *
 * No persiste nada — esta es la función pura que tanto la UI del form
 * (cálculo en vivo) como las páginas de detalle pueden reutilizar.
 */
export function calcularResumenSimulacion(input: SimulacionInput): ResumenSimulacion {
  const tcEmb = toDec(input.tipoCambio);

  const fobTotal = input.items.reduce(
    (acc, it) => acc.plus(toDec(it.precioUnitarioFob).times(it.cantidad)),
    new Decimal(0),
  );
  const fobTotalArs = round2(fobTotal.times(tcEmb));

  const fleteOrigenArs = input.valorFleteOrigen
    ? round2(toDec(input.valorFleteOrigen).times(tcEmb))
    : new Decimal(0);
  const seguroOrigenArs = input.valorSeguroOrigen
    ? round2(toDec(input.valorSeguroOrigen).times(tcEmb))
    : new Decimal(0);

  const costosLogisticosArs = input.costos.reduce((acc, c) => {
    return acc.plus(round2(toDec(c.subtotal).times(toDec(c.tipoCambio))));
  }, new Decimal(0));

  const dieArs = round2(toDec(input.die).times(tcEmb));
  const tasaEstadisticaArs = round2(toDec(input.tasaEstadistica).times(tcEmb));
  const arancelSimArs = round2(toDec(input.arancelSim).times(tcEmb));
  const tributosRateablesArs = round2(dieArs.plus(tasaEstadisticaArs).plus(arancelSimArs));

  const ivaArs = round2(toDec(input.iva).times(tcEmb));
  const ivaAdicionalArs = round2(toDec(input.ivaAdicional).times(tcEmb));
  const gananciasArs = round2(toDec(input.ganancias).times(tcEmb));
  const iibbArs = round2(toDec(input.iibb).times(tcEmb));
  const creditosFiscalesArs = round2(ivaArs.plus(ivaAdicionalArs).plus(gananciasArs).plus(iibbArs));

  const cifTotalArs = round2(
    fobTotalArs
      .plus(fleteOrigenArs)
      .plus(seguroOrigenArs)
      .plus(
        input.costos
          .filter((c) => c.tipo === "FLETE_INTERNACIONAL" || c.tipo === "SEGURO_MARITIMO")
          .reduce(
            (acc, c) => acc.plus(round2(toDec(c.subtotal).times(toDec(c.tipoCambio)))),
            new Decimal(0),
          ),
      ),
  );

  const costoTotalNacionalizadoArs = round2(
    fobTotalArs
      .plus(fleteOrigenArs)
      .plus(seguroOrigenArs)
      .plus(costosLogisticosArs)
      .plus(tributosRateablesArs),
  );

  const desembolsoTotalEstimadoArs = round2(costoTotalNacionalizadoArs.plus(creditosFiscalesArs));

  // Prorrateo por línea reusando el motor de embarque.
  let items: ItemRentabilidad[];
  if (input.items.length === 0 || fobTotal.lte(0)) {
    items = input.items.map((it, index) => ({
      index,
      productoId: it.productoId ?? null,
      descripcion: it.label ?? it.descripcionLibre ?? null,
      cantidad: it.cantidad,
      precioUnitarioFob: toDec(it.precioUnitarioFob),
      fobItem: round2(toDec(it.precioUnitarioFob).times(it.cantidad)),
      costoTotalArs: new Decimal(0),
      costoUnitarioArs: new Decimal(0),
      precioVentaUnitarioArs: it.precioVentaUnitario ? toDec(it.precioVentaUnitario) : null,
      margenUnitarioArs: null,
      margenPorcentaje: null,
      ingresoTotalArs: null,
      utilidadTotalArs: null,
    }));
  } else {
    const costos: CostoLogisticoInput[] = input.costos.map((c) => ({
      subtotal: c.subtotal,
      tipoCambio: c.tipoCambio,
    }));

    const rateado = calcularRateioEmbarque(
      {
        fobTotal,
        embarqueTipoCambio: tcEmb,
        costos,
        die: input.die,
        tasaEstadistica: input.tasaEstadistica,
        arancelSim: input.arancelSim,
        valorFleteOrigen: input.valorFleteOrigen ?? null,
        valorSeguroOrigen: input.valorSeguroOrigen ?? null,
      },
      input.items.map((it) => ({
        cantidad: it.cantidad,
        precioUnitarioFob: it.precioUnitarioFob,
        original: it,
      })),
    );

    items = rateado.map((r, index) => {
      const it = r.original;
      const precioVenta = it.precioVentaUnitario ? toDec(it.precioVentaUnitario) : null;
      const margenUnit = precioVenta ? round2(precioVenta.minus(r.costoUnitario)) : null;
      const margenPct =
        precioVenta && r.costoUnitario.gt(0)
          ? round2(precioVenta.minus(r.costoUnitario).dividedBy(r.costoUnitario).times(100))
          : null;
      const ingreso = precioVenta ? round2(precioVenta.times(it.cantidad)) : null;
      const utilidad = margenUnit ? round2(margenUnit.times(it.cantidad)) : null;

      return {
        index,
        productoId: it.productoId ?? null,
        descripcion: it.label ?? it.descripcionLibre ?? null,
        cantidad: it.cantidad,
        precioUnitarioFob: toDec(it.precioUnitarioFob),
        fobItem: r.fobItem,
        costoTotalArs: r.costoTotal,
        costoUnitarioArs: r.costoUnitario,
        precioVentaUnitarioArs: precioVenta,
        margenUnitarioArs: margenUnit,
        margenPorcentaje: margenPct,
        ingresoTotalArs: ingreso,
        utilidadTotalArs: utilidad,
      };
    });
  }

  const itemsConPrecio = items.filter((i) => i.precioVentaUnitarioArs !== null).length;
  const ingresoTotalArs = round2(
    items.reduce<Decimal>(
      (acc, i) => acc.plus(i.ingresoTotalArs ?? new Decimal(0)),
      new Decimal(0),
    ),
  );
  const utilidadTotalArs = round2(
    items.reduce<Decimal>(
      (acc, i) => acc.plus(i.utilidadTotalArs ?? new Decimal(0)),
      new Decimal(0),
    ),
  );
  const costoSubtotalConPrecio = round2(
    items
      .filter((i) => i.precioVentaUnitarioArs !== null)
      .reduce<Decimal>((acc, i) => acc.plus(i.costoTotalArs), new Decimal(0)),
  );
  const margenPromedioPorcentaje =
    itemsConPrecio > 0 && costoSubtotalConPrecio.gt(0)
      ? round2(utilidadTotalArs.dividedBy(costoSubtotalConPrecio).times(100))
      : null;

  return {
    fobTotal: round2(fobTotal),
    fobTotalArs,
    fleteOrigenArs,
    seguroOrigenArs,
    cifTotalArs,
    costosLogisticosArs: round2(costosLogisticosArs),
    dieArs,
    tasaEstadisticaArs,
    arancelSimArs,
    tributosRateablesArs,
    ivaArs,
    ivaAdicionalArs,
    gananciasArs,
    iibbArs,
    creditosFiscalesArs,
    costoTotalNacionalizadoArs,
    desembolsoTotalEstimadoArs,
    items,
    itemsConPrecio,
    costoSubtotalConPrecioArs: costoSubtotalConPrecio,
    ingresoTotalArs,
    utilidadTotalArs,
    margenPromedioPorcentaje,
  };
}
