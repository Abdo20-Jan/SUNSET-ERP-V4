import { describe, expect, it } from "vitest";

import {
  type EmbarqueComprasInput,
  agregarComprasMoneda,
  fobAUsd,
} from "@/lib/services/bi-compras-moneda";

function emb(over: Partial<EmbarqueComprasInput> = {}): EmbarqueComprasInput {
  return {
    codigo: "BR-1",
    proveedorNombre: "QINGDAO",
    moneda: "USD",
    tipoCambio: "1000",
    fobTotal: "100",
    costoTotal: "145000", // ARS landed
    tributos: {
      die: "5",
      tasaEstadistica: "1",
      arancel: "2",
      iva: "21",
      ivaAdicional: "0",
      ganancias: "0",
      iibb: "3",
    },
    costos: [
      {
        moneda: "USD",
        tipoCambio: "1000",
        lineas: [{ tipo: "FLETE_INTERNACIONAL", subtotal: "10" }],
      },
    ],
    ...over,
  };
}

describe("fobAUsd", () => {
  it("USD passthrough; ARS ÷ TC", () => {
    expect(Number(fobAUsd("100", "USD", "1000"))).toBe(100);
    expect(Number(fobAUsd("2000000", "ARS", "1000"))).toBe(2000);
  });
});

describe("agregarComprasMoneda", () => {
  it("FOB somado em USD nativo (passthrough USD + conversão ARS→USD)", () => {
    const r = agregarComprasMoneda([
      emb(),
      emb({
        codigo: "AR-1",
        proveedorNombre: "LOCAL SA",
        moneda: "ARS",
        tipoCambio: "1000",
        fobTotal: "2000000",
        costoTotal: "2200000",
        tributos: {
          die: "0",
          tasaEstadistica: "0",
          arancel: "0",
          iva: "0",
          ivaAdicional: "0",
          ganancias: "0",
          iibb: "0",
        },
        costos: [
          { moneda: "ARS", tipoCambio: "1", lineas: [{ tipo: "DESPACHANTE", subtotal: "50000" }] },
        ],
      }),
    ]);
    expect(r.importadoUsd).toBe(2100); // 100 + 2000
    expect(r.fobArs).toBe(2100000); // 100000 + 2000000
    expect(r.costoArs).toBe(2345000); // 145000 + 2200000
  });

  it("costoNacionalizadoPct compara MESMA moeda (ARS/ARS), não ARS/USD", () => {
    const r = agregarComprasMoneda([emb()]); // costo 145000 ARS, fob 100 USD (=100000 ARS)
    expect(r.costoNacionalizadoPct).toBe(1.45); // 145000 / 100000 — NÃO 1450 (bug ARS/USD)
  });

  it("distribución de costos convertida a ARS por TC da fatura; ordenada desc", () => {
    const r = agregarComprasMoneda([
      emb({
        costos: [
          {
            moneda: "USD",
            tipoCambio: "1000",
            lineas: [{ tipo: "FLETE_INTERNACIONAL", subtotal: "10" }],
          },
          { moneda: "ARS", tipoCambio: "1", lineas: [{ tipo: "DESPACHANTE", subtotal: "50000" }] },
        ],
      }),
    ]);
    expect(r.distribucionArs).toEqual([
      { tipo: "DESPACHANTE", value: 50000 }, // 50000 × 1
      { tipo: "FLETE_INTERNACIONAL", value: 10000 }, // 10 × 1000
    ]);
  });

  it("FOB por proveedor em USD, ordenado desc", () => {
    const r = agregarComprasMoneda([
      emb({ proveedorNombre: "QINGDAO", fobTotal: "100", moneda: "USD" }),
      emb({
        codigo: "AR-1",
        proveedorNombre: "LOCAL SA",
        fobTotal: "2000000",
        moneda: "ARS",
        tipoCambio: "1000",
      }),
    ]);
    expect(r.porProveedorUsd).toEqual([
      { label: "LOCAL SA", value: 2000 },
      { label: "QINGDAO", value: 100 },
    ]);
  });

  it("tributos por embarque convertidos a ARS (×TC do embarque)", () => {
    const r = agregarComprasMoneda([emb()]); // tc 1000
    expect(r.tributosArs[0]).toEqual({
      label: "BR-1",
      die: 5000,
      tasaEstadistica: 1000,
      arancel: 2000,
      iva: 21000,
      ivaAdicional: 0,
      ganancias: 0,
      iibb: 3000,
    });
  });

  it("sem embarques: zeros e pct 0 (sem divisão por zero)", () => {
    const r = agregarComprasMoneda([]);
    expect(r.importadoUsd).toBe(0);
    expect(r.costoNacionalizadoPct).toBe(0);
    expect(r.porProveedorUsd).toEqual([]);
  });
});
