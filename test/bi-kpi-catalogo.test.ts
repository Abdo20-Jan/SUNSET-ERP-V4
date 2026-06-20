import { describe, expect, it } from "vitest";

import { CATALOGO_KPI, kpiPorId, kpisPorCategoria } from "@/lib/services/bi-kpi-catalogo";
import type { GiroIndicadores } from "@/lib/services/bi-giro-formulas";
import type { LiquidezIndicadores } from "@/lib/services/bi-liquidez-formulas";

describe("CATALOGO_KPI", () => {
  it("tiene ids únicos", () => {
    const ids = CATALOGO_KPI.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("toda entrada tiene label, sigla, descripción y fórmula no vacías", () => {
    for (const k of CATALOGO_KPI) {
      expect(k.label.length).toBeGreaterThan(0);
      expect(k.sigla.length).toBeGreaterThan(0);
      expect(k.descripcion.length).toBeGreaterThan(0);
      expect(k.formula.length).toBeGreaterThan(0);
    }
  });

  it("kpiPorId / kpisPorCategoria resuelven", () => {
    expect(kpiPorId("giro.dso")?.sigla).toBe("DSO");
    expect(kpiPorId("inexistente")).toBeUndefined();
    expect(kpisPorCategoria("giro").length).toBe(5);
  });

  it("drift: cada indicador de giro calculado tiene su definición en el catálogo", () => {
    // Las claves de GiroIndicadores deben existir como `giro.<clave>` en el catálogo.
    const claves: (keyof GiroIndicadores)[] = ["dso", "dio", "dpo", "ccc", "nof"];
    for (const c of claves) {
      expect(kpiPorId(`giro.${c}`), `falta definición de giro.${c}`).toBeDefined();
    }
    // Y a la inversa: todo id de categoría giro corresponde a una clave calculada.
    for (const k of kpisPorCategoria("giro")) {
      const clave = k.id.replace(/^giro\./, "") as keyof GiroIndicadores;
      expect(claves).toContain(clave);
    }
  });

  it("drift: cada indicador de liquidez calculado tiene su definición en el catálogo", () => {
    const claves: (keyof LiquidezIndicadores)[] = [
      "razonCorriente",
      "pruebaAcida",
      "liquidezInmediata",
      "capitalTrabajo",
    ];
    for (const c of claves) {
      expect(kpiPorId(`liquidez.${c}`), `falta definición de liquidez.${c}`).toBeDefined();
    }
    for (const k of kpisPorCategoria("liquidez")) {
      const clave = k.id.replace(/^liquidez\./, "") as keyof LiquidezIndicadores;
      expect(claves).toContain(clave);
    }
    expect(kpisPorCategoria("liquidez").length).toBe(4);
  });
});
