import { describe, expect, it } from "vitest";
import { coeficiente, coeficienteEntrePeriodos } from "./indice-ipc-formulas";

describe("coeficiente", () => {
  it("cierre > origen → coeficiente > 1 (inflación)", () => {
    expect(coeficiente(100, 124.5)).toBeCloseTo(1.245, 5);
  });

  it("inflación compuesta (100 → 300 en el rango) → coeficiente 3", () => {
    expect(coeficiente(100, 300)).toBe(3);
  });

  it("origen === cierre → 1 (sin ajuste)", () => {
    expect(coeficiente(187.4, 187.4)).toBe(1);
  });

  it("defensivo: origen = 0 → 1 (no Infinity)", () => {
    expect(coeficiente(0, 250)).toBe(1);
  });

  it("defensivo: origen negativo → 1", () => {
    expect(coeficiente(-10, 250)).toBe(1);
  });

  it("defensivo: NaN en cualquier lado → 1", () => {
    expect(coeficiente(Number.NaN, 250)).toBe(1);
    expect(coeficiente(100, Number.NaN)).toBe(1);
  });
});

describe("coeficienteEntrePeriodos", () => {
  const serie: ReadonlyMap<string, number> = new Map([
    ["2024-01", 100],
    ["2024-12", 150],
  ]);

  it("usa los índices de la serie cargada", () => {
    expect(coeficienteEntrePeriodos(serie, "2024-01", "2024-12")).toBe(1.5);
  });

  it("período faltante → 1 (neutro)", () => {
    expect(coeficienteEntrePeriodos(serie, "2023-01", "2024-12")).toBe(1);
  });
});
