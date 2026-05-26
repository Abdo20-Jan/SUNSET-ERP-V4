import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

// Tests unitarios (sin DB) del helper de costo landed del despacho cruzado.
// Decisión: DIE + Tasa Estadística + Arancel SIM + subtotal de facturas
// DESPACHO capitalizan en el costo de la mercadería nacionalizada; se
// prorratean entre ítems proporcional a la base FOB (cantidad × costoFC).

import { calcularCostoLandedDespacho } from "@/lib/services/despacho-parcial";

describe("calcularCostoLandedDespacho", () => {
  it("un ítem: landed_unit = costoFC×TC + capitalizables/cant", () => {
    // costoFC 12.50 × TC 1000 = 12500/u × 30 = 375000 nacionalizado.
    // DIE 100 × TCdsp 1000 = 100000 capitalizable.
    // landed_unit = 12500 + 100000/30 = 12500 + 3333.3333 = 15833.3333.
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1000",
      tipoCambioDespacho: "1000",
      die: "100.00",
      tasaEstadistica: "0",
      arancelSim: "0",
      facturasDespacho: [],
      items: [
        { itemDespachoId: 1, productoId: "p1", cantidad: 30, costoFCUnitario: "12.5000" },
      ],
    });

    expect(r.nacionalizadoArs.toFixed(2)).toBe("375000.00");
    expect(r.tributosCapitalizablesArs.toFixed(2)).toBe("100000.00");
    expect(r.capitalizablesArs.toFixed(2)).toBe("100000.00");
    expect(r.costoTotalArs.toFixed(2)).toBe("475000.00");
    expect(r.costoUnitarioLandedPorItem.get(1)?.toFixed(4)).toBe("15833.3333");
  });

  it("incluye subtotal de facturas DESPACHO como capitalizable", () => {
    // FC 375000 nacionalizado + DIE 100000 + factura subtotal 50 USD × TC 1000 = 50000.
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1000",
      tipoCambioDespacho: "1000",
      die: "100.00",
      tasaEstadistica: "0",
      arancelSim: "0",
      facturasDespacho: [{ subtotal: "50.00", tipoCambio: "1000" }],
      items: [
        { itemDespachoId: 1, productoId: "p1", cantidad: 30, costoFCUnitario: "12.5000" },
      ],
    });

    expect(r.facturasCapitalizablesArs.toFixed(2)).toBe("50000.00");
    expect(r.capitalizablesArs.toFixed(2)).toBe("150000.00");
    expect(r.costoTotalArs.toFixed(2)).toBe("525000.00");
    // landed_unit = 12500 + 150000/30 = 12500 + 5000 = 17500.
    expect(r.costoUnitarioLandedPorItem.get(1)?.toFixed(4)).toBe("17500.0000");
  });

  it("prorratea capitalizables proporcional a la base FOB y reconcilia al centavo", () => {
    // Ítem A: 30 u × 10 = 300 base; Ítem B: 10 u × 20 = 200 base. Total 500.
    // costoFC ya en ARS (TC=1). Capitalizable DIE 100 (TC=1).
    // A recibe 100×300/500 = 60; B recibe el residuo 40.
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1",
      tipoCambioDespacho: "1",
      die: "100.00",
      tasaEstadistica: "0",
      arancelSim: "0",
      facturasDespacho: [],
      items: [
        { itemDespachoId: 1, productoId: "pA", cantidad: 30, costoFCUnitario: "10.0000" },
        { itemDespachoId: 2, productoId: "pB", cantidad: 10, costoFCUnitario: "20.0000" },
      ],
    });

    const a = r.porItem.find((x) => x.itemDespachoId === 1)!;
    const b = r.porItem.find((x) => x.itemDespachoId === 2)!;
    expect(a.capitalizablesItemArs.toFixed(2)).toBe("60.00");
    expect(b.capitalizablesItemArs.toFixed(2)).toBe("40.00");
    // Σ porItem.costoTotalArs == costoTotalArs (reconciliación exacta).
    const sumItems = r.porItem.reduce((acc, x) => acc.plus(x.costoTotalArs), new Decimal(0));
    expect(sumItems.toFixed(2)).toBe(r.costoTotalArs.toFixed(2));
    expect(r.costoTotalArs.toFixed(2)).toBe("600.00"); // 300+200 FOB + 100 DIE
  });

  it("TC despacho decimal: tributosCapitalizables = Σ round2(tributo×TC) por tributo (reconcilia con asiento al centavo)", () => {
    // Regresión del piloto AR-251223036CN-D4 (TC despacho 1399.5).
    // El asiento contabiliza DIE/Tasa/Arancel SEPARADAMENTE, cada uno
    // round2(tributo×TCdsp). Si el helper sumara USD primero y redondeara
    // una sola vez al final, los medios centavos (half-up) divergirían y
    // el asiento quedaría 0.01 fuera de balanza con TC decimal.
    // - DIE     1768.25 × 1399.5 = 2,474,665.875 → 2,474,665.88
    // - Tasa     331.55 × 1399.5 =   464,004.225 →   464,004.23
    // - Arancel   10.00 × 1399.5 =    13,995.000 →    13,995.00
    // Σ HABER aduana = 2,952,665.11  (NO 2,952,665.10 del agregado).
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1382.000000",
      tipoCambioDespacho: "1399.500000",
      die: "1768.25",
      tasaEstadistica: "331.55",
      arancelSim: "10.00",
      facturasDespacho: [],
      items: [
        { itemDespachoId: 1, productoId: "p1", cantidad: 100, costoFCUnitario: "123.0709" },
      ],
    });

    expect(r.tributosCapitalizablesArs.toFixed(2)).toBe("2952665.11");
    // Sin facturas DESPACHO: capitalizablesArs == tributosCapitalizablesArs.
    expect(r.capitalizablesArs.toFixed(2)).toBe("2952665.11");
    // Nacionalizado FC: round2(123.0709 × 1382) = 170083.9838 → 170083.98
    //  × 100 = 17008398.00.
    expect(r.nacionalizadoArs.toFixed(2)).toBe("17008398.00");
    expect(r.costoTotalArs.toFixed(2)).toBe("19961063.11");
  });

  it("TC despacho decimal con 3 ítems: Σ porItem.costoTotalArs == costoTotalArs", () => {
    // Mismo caso del D4 pero con prorrateo: confirma que el residuo se
    // absorbe en el último ítem y la reconciliación al centavo se preserva
    // con TC decimal (half-up por tributo).
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1382.000000",
      tipoCambioDespacho: "1399.500000",
      die: "1768.25",
      tasaEstadistica: "331.55",
      arancelSim: "10.00",
      facturasDespacho: [],
      items: [
        { itemDespachoId: 1, productoId: "pA", cantidad: 30, costoFCUnitario: "123.0709" },
        { itemDespachoId: 2, productoId: "pB", cantidad: 50, costoFCUnitario: "123.0709" },
        { itemDespachoId: 3, productoId: "pC", cantidad: 20, costoFCUnitario: "123.0709" },
      ],
    });
    const sumItems = r.porItem.reduce((acc, x) => acc.plus(x.costoTotalArs), new Decimal(0));
    expect(sumItems.toFixed(2)).toBe(r.costoTotalArs.toFixed(2));
    expect(r.tributosCapitalizablesArs.toFixed(2)).toBe("2952665.11");
  });

  it("fallback FOB=0 (muestras): prorratea por cantidad", () => {
    const r = calcularCostoLandedDespacho({
      tipoCambioEmbarque: "1",
      tipoCambioDespacho: "1",
      die: "100.00",
      tasaEstadistica: "0",
      arancelSim: "0",
      facturasDespacho: [],
      items: [
        { itemDespachoId: 1, productoId: "pA", cantidad: 30, costoFCUnitario: "0" },
        { itemDespachoId: 2, productoId: "pB", cantidad: 10, costoFCUnitario: "0" },
      ],
    });
    const a = r.porItem.find((x) => x.itemDespachoId === 1)!;
    const b = r.porItem.find((x) => x.itemDespachoId === 2)!;
    // 100 × 30/40 = 75 ; residuo 25.
    expect(a.capitalizablesItemArs.toFixed(2)).toBe("75.00");
    expect(b.capitalizablesItemArs.toFixed(2)).toBe("25.00");
  });
});
