import { describe, expect, it } from "vitest";

// Rollout USD de CRM Oportunidades — helper PURO de presentación del monto del
// kanban. Compone `fmtMontoPres` (native-aware, al TC de cierre) con el sufijo
// de la moneda de PRESENTACIÓN. El monto de la oportunidad viene en su moneda
// NATIVA (Oportunidad.moneda: ARS|USD, sin tipoCambio propio); el toggle de la
// página lo lleva a la moneda elegida. Sin RTL en el repo → TDD vía helper puro.
import { buildMontoLabel } from "@/app/(dashboard)/crm/oportunidades/pipeline/_helpers";

describe("buildMontoLabel (CRM Oportunidades — presentación USD)", () => {
  const TC = "1300";

  it("ARS nativo en presentación ARS: passthrough con sufijo", () => {
    expect(buildMontoLabel("50000", "ARS", "ARS", TC)).toBe("50.000,00 ARS");
  });

  it("USD nativo en presentación USD: 1 a 1 (no re-divide)", () => {
    expect(buildMontoLabel("100", "USD", "USD", TC)).toBe("100,00 USD");
  });

  it("USD nativo en presentación ARS: × TC (revaluación)", () => {
    expect(buildMontoLabel("100", "USD", "ARS", TC)).toBe("130.000,00 ARS");
  });

  it("ARS nativo en presentación USD: ÷ TC", () => {
    expect(buildMontoLabel("130000", "ARS", "USD", TC)).toBe("100,00 USD");
  });

  it("sin TC: degradación segura (valor nativo) con sufijo de presentación", () => {
    expect(buildMontoLabel("100", "USD", "ARS", null)).toBe("100,00 ARS");
  });
});
