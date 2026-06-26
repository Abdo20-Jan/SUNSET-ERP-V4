import { describe, expect, it } from "vitest";

import { calcularResumenSimulacion } from "@/lib/services/simulacion-importacion";

import { serializeGolden } from "./golden-serialize";

// GOLDEN FILE (CRIT-04/05/06) — trava a saída ATUAL do serviço canônico da
// simulación. Esta é a "MESMA função real" (CRIT-06) que o form/detalhe já
// usam e que `listarSimulaciones` passa a consumir em PR-016. O golden prova
// que o resultado (custo nacionalizado rateado + créditos fiscais + margens)
// é byte-idêntico antes e depois do fix (o serviço não é tocado).
//
// Invariante-chave: `costoTotalNacionalizadoArs` == Σ items.costoTotalArs
// (130000 == 91000 + 39000) — é o valor que a LISTA deve exibir.

describe("GOLDEN calcularResumenSimulacion", () => {
  it("USD@1000, FOB 70/30, flete/seguro origen, costos, tributos, créditos e precio de venta", () => {
    const r = calcularResumenSimulacion({
      moneda: "USD",
      tipoCambio: "1000",
      valorFleteOrigen: "5",
      valorSeguroOrigen: "5",
      die: "5",
      tasaEstadistica: "3",
      arancelSim: "2",
      iva: "21",
      ivaAdicional: "20",
      ganancias: "6",
      iibb: "2.5",
      items: [
        {
          productoId: null,
          descripcionLibre: "A",
          cantidad: 1,
          precioUnitarioFob: "70",
          precioVentaUnitario: "150000",
        },
        {
          productoId: null,
          descripcionLibre: "B",
          cantidad: 1,
          precioUnitarioFob: "30",
          precioVentaUnitario: "60000",
        },
      ],
      costos: [{ tipo: "FLETE_INTERNACIONAL", subtotal: "10", moneda: "USD", tipoCambio: "1000" }],
    });

    expect(serializeGolden(r)).toEqual({
      fobTotal: "100",
      fobTotalArs: "100000",
      fleteOrigenArs: "5000",
      seguroOrigenArs: "5000",
      cifTotalArs: "120000",
      costosLogisticosArs: "10000",
      dieArs: "5000",
      tasaEstadisticaArs: "3000",
      arancelSimArs: "2000",
      tributosRateablesArs: "10000",
      ivaArs: "21000",
      ivaAdicionalArs: "20000",
      gananciasArs: "6000",
      iibbArs: "2500",
      creditosFiscalesArs: "49500",
      costoTotalNacionalizadoArs: "130000",
      desembolsoTotalEstimadoArs: "179500",
      items: [
        {
          index: 0,
          productoId: null,
          descripcion: "A",
          cantidad: 1,
          precioUnitarioFob: "70",
          fobItem: "70",
          costoTotalArs: "91000",
          costoUnitarioArs: "91000",
          precioVentaUnitarioArs: "150000",
          margenUnitarioArs: "59000",
          margenPorcentaje: "64.84",
          ingresoTotalArs: "150000",
          utilidadTotalArs: "59000",
        },
        {
          index: 1,
          productoId: null,
          descripcion: "B",
          cantidad: 1,
          precioUnitarioFob: "30",
          fobItem: "30",
          costoTotalArs: "39000",
          costoUnitarioArs: "39000",
          precioVentaUnitarioArs: "60000",
          margenUnitarioArs: "21000",
          margenPorcentaje: "53.85",
          ingresoTotalArs: "60000",
          utilidadTotalArs: "21000",
        },
      ],
      itemsConPrecio: 2,
      costoSubtotalConPrecioArs: "130000",
      ingresoTotalArs: "210000",
      utilidadTotalArs: "80000",
      margenPromedioPorcentaje: "61.54",
    });
  });
});
