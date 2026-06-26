import { describe, expect, it } from "vitest";

import { calcularRateioEmbarque } from "@/lib/services/comex";

import { serializeGolden } from "./golden-serialize";

// GOLDEN FILE (CRIT-04/05) — trava a saída ATUAL do motor de rateio de
// embarque. É a função real que a simulación consome (via
// `calcularResumenSimulacion`) e também o fluxo real de ingresso de stock
// (`embarques.ts`). PR-016 NÃO toca esta função; o golden prova byte-
// identidade do motor que a simulación passa a usar diretamente na lista.

describe("GOLDEN calcularRateioEmbarque", () => {
  it("70/30 + flete/seguro origen + costos + tributos: rateio por base FOB e resíduo no último item", () => {
    const r = calcularRateioEmbarque(
      {
        fobTotal: "100",
        embarqueTipoCambio: "1000",
        costos: [{ subtotal: "10", tipoCambio: "1000" }],
        die: "5",
        tasaEstadistica: "3",
        arancelSim: "2",
        valorFleteOrigen: "5",
        valorSeguroOrigen: "5",
      },
      [
        { cantidad: 1, precioUnitarioFob: "70", sku: "A" },
        { cantidad: 1, precioUnitarioFob: "30", sku: "B" },
      ],
    );

    expect(serializeGolden(r)).toEqual([
      {
        cantidad: 1,
        precioUnitarioFob: "70",
        sku: "A",
        fobItem: "70",
        costoTotal: "91000",
        costoUnitario: "91000",
      },
      {
        cantidad: 1,
        precioUnitarioFob: "30",
        sku: "B",
        fobItem: "30",
        costoTotal: "39000",
        costoUnitario: "39000",
      },
    ]);
  });
});
