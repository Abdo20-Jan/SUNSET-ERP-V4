import { describe, expect, it } from "vitest";

// Rollout USD — helper `buildMonedaHref` del MonedaToggle.
//
// El toggle por default escribe `?moneda=` (presentación). Pero préstamos y
// pagos-historial ya usan `?moneda=` como FILTRO de datos; en esas pantallas el
// toggle usa `param="pres"` para no pisar el filtro. El helper es puro (sin
// React) para poder testear esa lógica de query param sin RTL.
import { buildMonedaHref } from "@/app/(dashboard)/reportes/_components/moneda-toggle-href";

describe("buildMonedaHref", () => {
  it("param por default 'moneda' sobre query vacío", () => {
    expect(buildMonedaHref("/compras", "", "USD")).toBe("/compras?moneda=USD");
  });

  it("preserva params existentes y agrega/setea moneda", () => {
    expect(buildMonedaHref("/compras", "page=2&perPage=20", "ARS")).toBe(
      "/compras?page=2&perPage=20&moneda=ARS",
    );
  });

  it("sobrescribe una moneda previa (no duplica)", () => {
    expect(buildMonedaHref("/compras", "moneda=ARS", "USD")).toBe("/compras?moneda=USD");
  });

  it("param custom 'pres' no pisa el filtro 'moneda' existente", () => {
    expect(buildMonedaHref("/tesoreria/prestamos", "moneda=USD", "ARS", "pres")).toBe(
      "/tesoreria/prestamos?moneda=USD&pres=ARS",
    );
  });

  it("param custom 'pres' sobrescribe un 'pres' previo, deja 'moneda' intacto", () => {
    expect(buildMonedaHref("/tesoreria/prestamos", "moneda=USD&pres=ARS", "USD", "pres")).toBe(
      "/tesoreria/prestamos?moneda=USD&pres=USD",
    );
  });
});
