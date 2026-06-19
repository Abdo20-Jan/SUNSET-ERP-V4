import { describe, expect, it } from "vitest";

import {
  buildViewConfig,
  coerceViewConfig,
  hayParamsDeVista,
  viewConfigToSearchParams,
} from "@/lib/saved-views";

describe("buildViewConfig", () => {
  it("captura los params de vista y descarta paginación/formato", () => {
    const sp = new URLSearchParams(
      "q=cubierta&marca=Pirelli&sort=nombre&dir=desc&page=3&perPage=50&formato=xlsx",
    );
    const config = buildViewConfig(sp, { ncm: false, medida: false });
    expect(config.params).toEqual({ q: "cubierta", marca: "Pirelli", sort: "nombre", dir: "desc" });
    expect(config.columns).toEqual({ ncm: false, medida: false });
  });

  it("ignora valores vacíos", () => {
    const sp = new URLSearchParams("q=&marca=Bridgestone");
    const config = buildViewConfig(sp, {});
    expect(config.params).toEqual({ marca: "Bridgestone" });
  });
});

describe("viewConfigToSearchParams", () => {
  it("reconstruye los params (sin paginación) y es round-trip estable", () => {
    const sp = new URLSearchParams(
      "q=cubierta&marca=Pirelli&sort=nombre&dir=desc&page=3&perPage=50",
    );
    const config = buildViewConfig(sp, { ncm: false });
    const back = viewConfigToSearchParams(config);
    expect(back.get("q")).toBe("cubierta");
    expect(back.get("marca")).toBe("Pirelli");
    expect(back.get("sort")).toBe("nombre");
    expect(back.get("dir")).toBe("desc");
    expect(back.has("page")).toBe(false);
    expect(back.has("perPage")).toBe(false);
  });

  it("config sin params → query string vacía", () => {
    expect(viewConfigToSearchParams({ params: {}, columns: { ncm: false } }).toString()).toBe("");
  });
});

describe("hayParamsDeVista", () => {
  it("false cuando la URL está vacía o sólo tiene paginación/formato", () => {
    expect(hayParamsDeVista(new URLSearchParams(""))).toBe(false);
    expect(hayParamsDeVista(new URLSearchParams("page=2&perPage=50&formato=csv"))).toBe(false);
  });

  it("true cuando hay algún filtro/orden", () => {
    expect(hayParamsDeVista(new URLSearchParams("page=2&q=x"))).toBe(true);
    expect(hayParamsDeVista(new URLSearchParams("sort=nombre"))).toBe(true);
  });
});

describe("coerceViewConfig", () => {
  it("normaliza JSON bien formado", () => {
    const v = coerceViewConfig({ params: { q: "x", dir: "asc" }, columns: { ncm: false } });
    expect(v).toEqual({ params: { q: "x", dir: "asc" }, columns: { ncm: false } });
  });

  it("descarta tipos inválidos y entradas no-string/no-boolean", () => {
    const v = coerceViewConfig({
      params: { q: "x", n: 3, ok: "1" },
      columns: { a: true, b: "no", c: 0 },
    });
    expect(v.params).toEqual({ q: "x", ok: "1" });
    expect(v.columns).toEqual({ a: true });
  });

  it("valores nulos/ausentes → config vacía", () => {
    expect(coerceViewConfig(null)).toEqual({ params: {}, columns: {} });
    expect(coerceViewConfig(undefined)).toEqual({ params: {}, columns: {} });
    expect(coerceViewConfig("basura")).toEqual({ params: {}, columns: {} });
    expect(coerceViewConfig({})).toEqual({ params: {}, columns: {} });
  });
});
