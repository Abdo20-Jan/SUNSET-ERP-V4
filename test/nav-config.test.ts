import { describe, expect, it } from "vitest";
import { CENTERS, ALL_NAV_ITEMS, type CenterId } from "@/components/layout/nav-config";

describe("nav-config", () => {
  it("tiene los 7 centers de barra + Configuración", () => {
    const ids = CENTERS.map((c) => c.id);
    expect(ids).toEqual([
      "inicio", "comercial", "abastecimiento", "comex",
      "inventario", "finanzas", "contabilidad", "configuracion",
    ]);
    expect(CENTERS.filter((c) => !c.inUserMenu).map((c) => c.id)).toHaveLength(7);
    expect(CENTERS.find((c) => c.id === "configuracion")?.inUserMenu).toBe(true);
  });

  it("cada center tiene overviewHref dentro de sus routePrefixes", () => {
    for (const c of CENTERS) {
      expect(c.routePrefixes.length).toBeGreaterThan(0);
      const cubierto = c.routePrefixes.some(
        (p) => c.overviewHref === p || c.overviewHref.startsWith(`${p}/`),
      );
      expect(cubierto, `overview de ${c.id} (${c.overviewHref}) fuera de prefixes`).toBe(true);
    }
  });

  it("no hay routePrefix duplicado entre centers", () => {
    const all = CENTERS.flatMap((c) => c.routePrefixes);
    expect(new Set(all).size).toBe(all.length);
  });

  it("todos los hrefs empiezan con / y ALL_NAV_ITEMS no tiene href repetido", () => {
    const hrefs = ALL_NAV_ITEMS.map((i) => i.href);
    for (const h of hrefs) expect(h.startsWith("/")).toBe(true);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
