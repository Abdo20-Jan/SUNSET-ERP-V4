import { describe, expect, it } from "vitest";

// Rollout USD del dashboard — helper de presentación `convertirMonto`.
//
// A diferencia de `convertirAUsd` (sólo ARS→USD, usado por los reportes cuyos
// valores ya son todos ARS), el dashboard tiene valores NATIVOS mixtos (saldos
// bancarios y préstamos en su moneda nativa). `convertirMonto` es native-aware
// y bidireccional: preserva lo que ya está en la moneda destino ("1 a 1") y
// convierte sólo lo que está en otra moneda, al TC de cierre.
import { convertirMonto } from "@/lib/format";

describe("convertirMonto", () => {
  it("misma moneda (ARS→ARS): passthrough exacto, sin tocar el TC", () => {
    expect(convertirMonto("1000.50", "ARS", "ARS", "1300")).toBe("1000.50");
  });

  it("misma moneda (USD→USD): passthrough exacto", () => {
    expect(convertirMonto("25000.00", "USD", "USD", "1300")).toBe("25000.00");
  });

  it("ARS→USD: divide por el TC", () => {
    expect(convertirMonto("130000", "ARS", "USD", "1300")).toBe("100.00");
  });

  it("USD→ARS: multiplica por el TC", () => {
    expect(convertirMonto("100", "USD", "ARS", "1300")).toBe("130000.00");
  });

  it("ARS→USD con decimales: redondea a 2", () => {
    // 100 / 1300 = 0.0769... → 0.08
    expect(convertirMonto("100", "ARS", "USD", "1300")).toBe("0.08");
  });

  it("tc null → passthrough (no se puede convertir)", () => {
    expect(convertirMonto("100", "USD", "ARS", null)).toBe("100");
  });

  it("tc undefined → passthrough", () => {
    expect(convertirMonto("100", "ARS", "USD", undefined)).toBe("100");
  });

  it("tc 0 → passthrough (evita división por cero)", () => {
    expect(convertirMonto("100", "ARS", "USD", "0")).toBe("100");
  });

  it("tc no numérico → passthrough", () => {
    expect(convertirMonto("100", "ARS", "USD", "abc")).toBe("100");
  });

  it("valor no finito → passthrough", () => {
    expect(convertirMonto("abc", "ARS", "USD", "1300")).toBe("abc");
  });
});
