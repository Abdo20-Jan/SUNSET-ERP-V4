import { describe, expect, it } from "vitest";

// Rollout USD de las pantallas de Compras (lista/detalle/pedidos) — helper de
// presentación `fmtMontoPres`. Compone `convertirMonto` (native-aware, al TC de
// cierre) con `fmtMoney` (formato es-AR), SIN sufijo de moneda. Los valores de
// compras/pedidos vienen en moneda NATIVA mixta (facturas de importación USD,
// locales ARS); este helper los lleva a la moneda de presentación y los formatea.
// El sufijo `{monedaPres}` se anexa en el call-site (totales/stats sí, columnas
// de ítem no).
import { fmtMontoPres } from "@/lib/format";

describe("fmtMontoPres", () => {
  it("USD→USD: passthrough (preserva el nativo 1 a 1) y formatea es-AR", () => {
    // Vista USD de una factura USD: NO se re-divide por el TC.
    expect(fmtMontoPres("25000.00", "USD", "USD", "1300")).toBe("25.000,00");
  });

  it("USD→USD: passthrough aun SIN cotización (no necesita TC)", () => {
    expect(fmtMontoPres("25000", "USD", "USD", null)).toBe("25.000,00");
  });

  it("ARS→USD: divide por el TC de cierre y formatea", () => {
    // 130.000 ARS / 1300 = 100,00 USD
    expect(fmtMontoPres("130000", "ARS", "USD", "1300")).toBe("100,00");
  });

  it("USD→ARS: multiplica por el TC de cierre (revaluación) y formatea", () => {
    // 100 USD × 1300 = 130.000,00 ARS
    expect(fmtMontoPres("100", "USD", "ARS", "1300")).toBe("130.000,00");
  });

  it("ARS→ARS: passthrough con decimales", () => {
    expect(fmtMontoPres("1000.5", "ARS", "ARS", "1300")).toBe("1.000,50");
  });

  it("cross-moneda SIN tc: degradación segura (número nativo formateado)", () => {
    // Sin cotización el valor nativo se muestra tal cual (el sufijo del
    // call-site indicará la moneda de presentación; el toggle USD se deshabilita
    // cuando no hay TC, así que este caso es de borde).
    expect(fmtMontoPres("1234.5", "ARS", "USD", null)).toBe("1.234,50");
  });

  it("tc inválido (0) → passthrough (evita división por cero)", () => {
    expect(fmtMontoPres("130000", "ARS", "USD", "0")).toBe("130.000,00");
  });

  it("valor negativo: convierte y conserva el signo", () => {
    expect(fmtMontoPres("-100", "USD", "ARS", "1300")).toBe("-130.000,00");
  });

  it("valor no finito → fmtMoney devuelve el string original sin tocar", () => {
    expect(fmtMontoPres("abc", "ARS", "USD", "1300")).toBe("abc");
  });
});

// Rollout USD de las LISTAS de Comex (embarques + simulaciones). Documenta la
// semántica de moneda REAL de cada campo verificada en los servicios:
//   - FOB: NATIVO en la moneda del embarque/simulación (USD o ARS).
//   - CIF / costoTotal / costoTotalNacionalizado: ya consolidados en ARS (cada
//     parcela × su propio TC antes de sumar) → se tratan como ARS-nativos.
// La presentación los lleva a la moneda elegida con el TC de cierre. No hay
// `÷tc` ciego sobre mezcla de monedas (lección #262/#263).
describe("fmtMontoPres — semántica Comex listas", () => {
  const TC = "1300";

  it("FOB USD nativo en vista USD: 1 a 1 (no re-divide)", () => {
    expect(fmtMontoPres("1000", "USD", "USD", TC)).toBe("1.000,00");
  });

  it("FOB USD nativo en vista ARS: × TC", () => {
    expect(fmtMontoPres("1000", "USD", "ARS", TC)).toBe("1.300.000,00");
  });

  it("FOB ARS nativo (embarque ARS) en vista USD: ÷ TC", () => {
    expect(fmtMontoPres("1300000", "ARS", "USD", TC)).toBe("1.000,00");
  });

  it("CIF/costo (ARS consolidado) en vista USD: ÷ TC", () => {
    expect(fmtMontoPres("130000", "ARS", "USD", TC)).toBe("100,00");
  });

  it("CIF/costo (ARS consolidado) en vista ARS: passthrough", () => {
    expect(fmtMontoPres("130000", "ARS", "ARS", TC)).toBe("130.000,00");
  });
});
