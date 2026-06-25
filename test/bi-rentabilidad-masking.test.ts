import { afterEach, describe, expect, it, vi } from "vitest";

// BI · rentabilidad strip (PR-011). Mockeamos los wrappers de permiso y
// alimentamos un `AnalisisLucro` fijo para verificar el strip en la frontera del
// server component (sin tocar el motor BI).

const h = vi.hoisted(() => ({ puedeVerMargen: vi.fn(), puedeVerCosto: vi.fn() }));

vi.mock("@/lib/permisos-masking", () => ({
  puedeVerMargen: h.puedeVerMargen,
  puedeVerCosto: h.puedeVerCosto,
}));

import { stripAnalisisLucro } from "@/app/(dashboard)/bi/_tabs/rentabilidad-strip";

function fixture() {
  return {
    indicadores: {
      margenBruto: 100,
      margenBrutoPct: 0.3,
      ebit: 80,
      margenOperativoPct: 0.24,
      ebitda: 90,
      margenEbitdaPct: 0.27,
      resultadoNeto: 60,
      margenNetoPct: 0.18,
    },
    inputs: {
      ventas: 1000,
      resultadoBruto: 100,
      ebit: 80,
      depreciacionAmortizacion: 10,
      resultadoNeto: 60,
    },
    dimensionales: {
      margenPorCanal: [{ label: "Mayorista", value: 0.3 }],
      margenPorMarca: [{ label: "ACME", value: 0.25 }],
      precioVsCosto: [{ producto: "P1", precio: 10, costo: 7 }],
      margenBrutoMensal: [{ label: "2026-01", value: 50 }],
      topProductosMargen: [{ producto: "P1", margen: 3, pct: 0.3 }],
      vendidosBajoCosto: [{ producto: "P2", precio: 5, costo: 8 }],
    },
  };
}

afterEach(() => vi.clearAllMocks());

describe("stripAnalisisLucro", () => {
  it("sin margenes.ver ⇒ indicadores null, series de margen vacías, inputs salvo ventas null", async () => {
    h.puedeVerMargen.mockResolvedValue(false);
    h.puedeVerCosto.mockResolvedValue(false);

    const out = await stripAnalisisLucro(fixture());

    for (const v of Object.values(out.indicadores)) expect(v).toBeNull();
    expect(out.dimensionales.margenPorCanal).toEqual([]);
    expect(out.dimensionales.margenPorMarca).toEqual([]);
    expect(out.dimensionales.precioVsCosto).toEqual([]);
    expect(out.dimensionales.margenBrutoMensal).toEqual([]);
    expect(out.dimensionales.topProductosMargen).toEqual([]);
    expect(out.dimensionales.vendidosBajoCosto).toEqual([]);
    // ventas (ingresos) NO es sensible → se preserva para la cascada.
    expect(out.inputs.ventas).toBe(1000);
    // El resto de inputs (resultado contable) sí se strip-ea.
    expect(out.inputs.resultadoBruto).toBeNull();
    expect(out.inputs.ebit).toBeNull();
    expect(out.inputs.resultadoNeto).toBeNull();
  });

  it("con margenes.ver pero sin costos.ver ⇒ margen visible, columnas de costo crudo vacías", async () => {
    h.puedeVerMargen.mockResolvedValue(true);
    h.puedeVerCosto.mockResolvedValue(false);

    const out = await stripAnalisisLucro(fixture());

    expect(out.indicadores.margenBruto).toBe(100);
    expect(out.dimensionales.margenPorCanal).toHaveLength(1);
    expect(out.dimensionales.topProductosMargen).toHaveLength(1);
    // precioVsCosto / vendidosBajoCosto exponen el costo unitario crudo.
    expect(out.dimensionales.precioVsCosto).toEqual([]);
    expect(out.dimensionales.vendidosBajoCosto).toEqual([]);
  });

  it("con ambas claves ⇒ devuelve el análisis intacto (backward-compat)", async () => {
    h.puedeVerMargen.mockResolvedValue(true);
    h.puedeVerCosto.mockResolvedValue(true);

    const base = fixture();
    const out = await stripAnalisisLucro(base);

    expect(out.indicadores).toEqual(base.indicadores);
    expect(out.inputs).toEqual(base.inputs);
    expect(out.dimensionales).toEqual(base.dimensionales);
  });
});
