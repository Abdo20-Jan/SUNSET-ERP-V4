import { describe, expect, it } from "vitest";
import { getBreadcrumb } from "@/lib/nav/center-activo";

describe("getBreadcrumb", () => {
  it("center + módulo + id → Comex › Embarques › Detalle", () => {
    expect(getBreadcrumb("/comex/embarques/abc123def456ghi789jkl")).toEqual([
      { label: "Comex", href: "/comex" },
      { label: "Embarques", href: "/comex/embarques" },
      { label: "Detalle" },
    ]);
  });
  it("hub del center → solo el center", () => {
    expect(getBreadcrumb("/comex")).toEqual([{ label: "Comex" }]);
  });
  it("módulo en prefijo distinto del overview → Comercial › Leads › Detalle", () => {
    expect(getBreadcrumb("/crm/leads/abc123def456ghi789jkl")).toEqual([
      { label: "Comercial", href: "/ventas" },
      { label: "Leads", href: "/crm/leads" },
      { label: "Detalle" },
    ]);
  });
  it("gasto bajo Finanzas (no inyecta Tesorería) → Finanzas › Gastos › Nuevo", () => {
    expect(getBreadcrumb("/gastos/nuevo")).toEqual([
      { label: "Finanzas", href: "/tesoreria" },
      { label: "Gastos", href: "/gastos" },
      { label: "Nuevo" },
    ]);
  });
  it("módulo en el overviewHref no se duplica → Contabilidad › Asientos", () => {
    expect(getBreadcrumb("/contabilidad/asientos")).toEqual([
      { label: "Contabilidad", href: "/contabilidad" },
      { label: "Asientos" },
    ]);
  });
  it("detalle bajo overview → Contabilidad › Asientos › Detalle", () => {
    expect(getBreadcrumb("/contabilidad/asientos/abc123def456ghi789jkl")).toEqual([
      { label: "Contabilidad", href: "/contabilidad" },
      { label: "Asientos", href: "/contabilidad/asientos" },
      { label: "Detalle" },
    ]);
  });
  it("módulo == hub del center → Finanzas › Movimientos", () => {
    expect(getBreadcrumb("/tesoreria/movimientos")).toEqual([
      { label: "Finanzas", href: "/tesoreria" },
      { label: "Movimientos" },
    ]);
  });
  it("segmento suelto bajo el overview → Comercial › Nueva", () => {
    expect(getBreadcrumb("/ventas/nueva")).toEqual([
      { label: "Comercial", href: "/ventas" },
      { label: "Nueva" },
    ]);
  });
  it("ruta desconocida → []", () => {
    expect(getBreadcrumb("/zzz")).toEqual([]);
  });
});
