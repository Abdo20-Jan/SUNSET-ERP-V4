import { describe, expect, it } from "vitest";

import { calcularLucro } from "@/lib/services/bi-lucro-formulas";

describe("calcularLucro", () => {
  it("calcula la cascada y los márgenes con entradas limpias", () => {
    const r = calcularLucro({
      ventas: 1000,
      resultadoBruto: 400,
      ebit: 250,
      depreciacionAmortizacion: 50,
      resultadoNeto: 150,
    });
    expect(r.margenBruto).toBe(400);
    expect(r.margenBrutoPct).toBeCloseTo(0.4); // 400 / 1000
    expect(r.ebit).toBe(250);
    expect(r.margenOperativoPct).toBeCloseTo(0.25); // 250 / 1000
    expect(r.ebitda).toBe(300); // 250 + 50
    expect(r.margenEbitdaPct).toBeCloseTo(0.3); // 300 / 1000
    expect(r.resultadoNeto).toBe(150);
    expect(r.margenNetoPct).toBeCloseTo(0.15); // 150 / 1000
  });

  it("EBITDA reincorpora la depreciación/amortización al EBIT", () => {
    const r = calcularLucro({
      ventas: 1000,
      resultadoBruto: 400,
      ebit: 200,
      depreciacionAmortizacion: 120,
      resultadoNeto: 100,
    });
    expect(r.ebitda).toBe(320);
    expect(r.ebitda).toBeGreaterThan(r.ebit); // siempre ≥ EBIT con D&A ≥ 0
  });

  it("margen neto ≠ margen bruto (regresión del bug de la tab vieja)", () => {
    const r = calcularLucro({
      ventas: 1000,
      resultadoBruto: 400,
      ebit: 250,
      depreciacionAmortizacion: 0,
      resultadoNeto: 150,
    });
    expect(r.margenNetoPct).not.toBeCloseTo(r.margenBrutoPct);
    expect(r.margenNetoPct).toBeCloseTo(0.15);
    expect(r.margenBrutoPct).toBeCloseTo(0.4);
  });

  it("es zero-safe cuando no hay ventas (post-wipe / 0 asientos)", () => {
    const r = calcularLucro({
      ventas: 0,
      resultadoBruto: 0,
      ebit: 0,
      depreciacionAmortizacion: 0,
      resultadoNeto: 0,
    });
    expect(r).toEqual({
      margenBruto: 0,
      margenBrutoPct: 0,
      ebit: 0,
      margenOperativoPct: 0,
      ebitda: 0,
      margenEbitdaPct: 0,
      resultadoNeto: 0,
      margenNetoPct: 0,
    });
  });

  it("no divide por cero ni produce porcentajes con ventas negativas", () => {
    const r = calcularLucro({
      ventas: -500,
      resultadoBruto: -100,
      ebit: -200,
      depreciacionAmortizacion: 30,
      resultadoNeto: -250,
    });
    // ventas ≤ 0 → todos los % en 0; los montos pasan crudos.
    expect(r.margenBrutoPct).toBe(0);
    expect(r.margenOperativoPct).toBe(0);
    expect(r.margenEbitdaPct).toBe(0);
    expect(r.margenNetoPct).toBe(0);
    expect(r.ebitda).toBe(-170); // −200 + 30
    expect(r.resultadoNeto).toBe(-250);
  });

  it("maneja resultado neto negativo (pérdida) con ventas positivas", () => {
    const r = calcularLucro({
      ventas: 1000,
      resultadoBruto: 200,
      ebit: -50,
      depreciacionAmortizacion: 40,
      resultadoNeto: -120,
    });
    expect(r.margenOperativoPct).toBeCloseTo(-0.05);
    expect(r.margenNetoPct).toBeCloseTo(-0.12);
    expect(r.ebitda).toBe(-10); // −50 + 40
    expect(r.margenEbitdaPct).toBeCloseTo(-0.01);
  });
});
