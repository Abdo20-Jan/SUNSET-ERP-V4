import { describe, expect, it } from "vitest";

import { calcularCostoLandedDespacho } from "@/lib/services/despacho-parcial";

import { serializeGolden } from "./golden-serialize";

// GOLDEN FILE (CRIT-04/05) — trava byte a byte a saída ATUAL do motor de
// custo landed do despacho cruzado. PR-016 (fix CRIT-06 da simulación) NÃO
// toca esta função; este golden prova que o caminho de despacho/asiento
// permanece byte-idêntico. Qualquer divergência aqui é regressão do rateio
// e exige aprovação PO+Diretor (DO-NOT-TOUCH — [[09_COMEX_RATEIO_DO_NOT_TOUCH]]).
//
// Os valores foram capturados da implementação vigente; complementa
// `costo-landed-despacho.test.ts` (que checa campos isolados) travando o
// objeto COMPLETO, incluindo porItem e o Map costoUnitarioLandedPorItem.

describe("GOLDEN calcularCostoLandedDespacho", () => {
  it("70/30 + capitalizables (exemplo verbatim do DO_NOT_TOUCH): A→84000, B→36000", () => {
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1000",
      tipoCambioDespacho: "1000",
      die: "20.00",
      tasaEstadistica: "0",
      arancelSim: "0",
      facturasDespacho: [],
      items: [
        { itemDespachoId: 1, productoId: "pA", cantidad: 1, costoFCUnitario: "70.0000" },
        { itemDespachoId: 2, productoId: "pB", cantidad: 1, costoFCUnitario: "30.0000" },
      ],
    });

    expect(serializeGolden(r)).toEqual({
      nacionalizadoArs: "100000",
      tributosCapitalizablesArs: "20000",
      facturasCapitalizablesArs: "0",
      capitalizablesArs: "20000",
      costoTotalArs: "120000",
      porItem: [
        {
          itemDespachoId: 1,
          productoId: "pA",
          cantidad: 1,
          costoFcUnitarioArs: "70000",
          capitalizablesItemArs: "14000",
          costoTotalArs: "84000",
          costoUnitarioLandedArs: "84000",
        },
        {
          itemDespachoId: 2,
          productoId: "pB",
          cantidad: 1,
          costoFcUnitarioArs: "30000",
          capitalizablesItemArs: "6000",
          costoTotalArs: "36000",
          costoUnitarioLandedArs: "36000",
        },
      ],
      costoUnitarioLandedPorItem: { "1": "84000", "2": "36000" },
    });
  });

  it("TC despacho decimal (1399.5) + factura DESPACHO + 3 itens: half-up por tributo e resíduo no último", () => {
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1382.000000",
      tipoCambioDespacho: "1399.500000",
      die: "1768.25",
      tasaEstadistica: "331.55",
      arancelSim: "10.00",
      facturasDespacho: [{ subtotal: "40.00", tipoCambio: "1399.500000" }],
      items: [
        { itemDespachoId: 1, productoId: "pA", cantidad: 30, costoFCUnitario: "123.0709" },
        { itemDespachoId: 2, productoId: "pB", cantidad: 50, costoFCUnitario: "123.0709" },
        { itemDespachoId: 3, productoId: "pC", cantidad: 20, costoFCUnitario: "123.0709" },
      ],
    });

    expect(serializeGolden(r)).toEqual({
      nacionalizadoArs: "17008398",
      tributosCapitalizablesArs: "2952665.11",
      facturasCapitalizablesArs: "55980",
      capitalizablesArs: "3008645.11",
      costoTotalArs: "20017043.11",
      porItem: [
        {
          itemDespachoId: 1,
          productoId: "pA",
          cantidad: 30,
          costoFcUnitarioArs: "170083.98",
          capitalizablesItemArs: "902593.53",
          costoTotalArs: "6005112.93",
          costoUnitarioLandedArs: "200170.431",
        },
        {
          itemDespachoId: 2,
          productoId: "pB",
          cantidad: 50,
          costoFcUnitarioArs: "170083.98",
          capitalizablesItemArs: "1504322.56",
          costoTotalArs: "10008521.56",
          costoUnitarioLandedArs: "200170.4312",
        },
        {
          itemDespachoId: 3,
          productoId: "pC",
          cantidad: 20,
          costoFcUnitarioArs: "170083.98",
          capitalizablesItemArs: "601729.02",
          costoTotalArs: "4003408.62",
          costoUnitarioLandedArs: "200170.431",
        },
      ],
      costoUnitarioLandedPorItem: {
        "1": "200170.431",
        "2": "200170.4312",
        "3": "200170.431",
      },
    });
  });
});
