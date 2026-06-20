import { describe, expect, it } from "vitest";

import { calcularLiquidez } from "@/lib/services/bi-liquidez-formulas";

describe("calcularLiquidez", () => {
  it("calcula los ratios y el capital de trabajo con entradas limpias", () => {
    const r = calcularLiquidez({
      activoCorriente: 1500,
      pasivoCorriente: 1000,
      inventario: 600,
      disponibilidades: 300,
    });
    expect(r.razonCorriente).toBeCloseTo(1.5);
    expect(r.pruebaAcida).toBeCloseTo((1500 - 600) / 1000); // 0.9
    expect(r.liquidezInmediata).toBeCloseTo(0.3);
    expect(r.capitalTrabajo).toBe(500);
  });

  it("es zero-safe cuando el pasivo corriente es 0 (post-wipe)", () => {
    const r = calcularLiquidez({
      activoCorriente: 1500,
      pasivoCorriente: 0,
      inventario: 600,
      disponibilidades: 300,
    });
    expect(r.razonCorriente).toBe(0);
    expect(r.pruebaAcida).toBe(0);
    expect(r.liquidezInmediata).toBe(0);
    expect(r.capitalTrabajo).toBe(1500); // CT no divide: AC − 0
  });

  it("capital de trabajo negativo cuando el pasivo corriente domina", () => {
    const r = calcularLiquidez({
      activoCorriente: 500,
      pasivoCorriente: 1000,
      inventario: 0,
      disponibilidades: 100,
    });
    expect(r.capitalTrabajo).toBe(-500);
    expect(r.razonCorriente).toBeCloseTo(0.5);
  });
});
