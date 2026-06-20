import { describe, expect, it } from "vitest";

import { calcularGiro, diasDelPeriodo } from "@/lib/services/bi-giro-formulas";

describe("calcularGiro", () => {
  it("calcula DSO/DIO/DPO/CCC/NOF con entradas limpias", () => {
    const r = calcularGiro({
      ventasPeriodo: 1000,
      cmvPeriodo: 500,
      inventario: 250,
      cxc: 300,
      cxpComercial: 100,
      diasPeriodo: 30,
    });
    expect(r.dso).toBeCloseTo((300 / 1000) * 30); // 9
    expect(r.dio).toBeCloseTo((250 / 500) * 30); // 15
    expect(r.dpo).toBeCloseTo((100 / 500) * 30); // 6
    expect(r.ccc).toBeCloseTo(9 + 15 - 6); // 18
    expect(r.nof).toBe(300 + 250 - 100); // 450
  });

  it("es zero-safe cuando los flujos son 0 (post-wipe)", () => {
    const r = calcularGiro({
      ventasPeriodo: 0,
      cmvPeriodo: 0,
      inventario: 0,
      cxc: 0,
      cxpComercial: 0,
      diasPeriodo: 30,
    });
    expect(r).toEqual({ dso: 0, dio: 0, dpo: 0, ccc: 0, nof: 0 });
  });

  it("no divide por cero días", () => {
    const r = calcularGiro({
      ventasPeriodo: 1000,
      cmvPeriodo: 500,
      inventario: 250,
      cxc: 300,
      cxpComercial: 100,
      diasPeriodo: 0,
    });
    expect(r.dso).toBe(0);
    expect(r.dio).toBe(0);
    expect(r.dpo).toBe(0);
    expect(r.ccc).toBe(0);
    expect(r.nof).toBe(450); // NOF no depende de los días
  });

  it("CCC puede ser negativo cuando DPO domina", () => {
    const r = calcularGiro({
      ventasPeriodo: 1000,
      cmvPeriodo: 1000,
      inventario: 0,
      cxc: 0,
      cxpComercial: 1000,
      diasPeriodo: 30,
    });
    expect(r.ccc).toBeCloseTo(-30);
  });
});

describe("diasDelPeriodo", () => {
  it("cuenta días inclusivos (apertura y cierre)", () => {
    expect(
      diasDelPeriodo(new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-31T23:59:59.999Z")),
    ).toBe(31);
    expect(
      diasDelPeriodo(new Date("2026-01-10T00:00:00.000Z"), new Date("2026-01-10T23:59:59.999Z")),
    ).toBe(1);
  });

  it("devuelve 0 si falta o se invierte el rango", () => {
    expect(diasDelPeriodo(null, null)).toBe(0);
    expect(diasDelPeriodo(undefined, new Date("2026-01-31T23:59:59.999Z"))).toBe(0);
    expect(
      diasDelPeriodo(new Date("2026-02-01T00:00:00.000Z"), new Date("2026-01-01T00:00:00.000Z")),
    ).toBe(0);
  });
});
