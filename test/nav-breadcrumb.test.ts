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

  it("hub del center → solo el center (sin duplicar)", () => {
    expect(getBreadcrumb("/comex")).toEqual([{ label: "Comex" }]);
  });

  it("center distinto del módulo → Finanzas › Tesorería › Movimientos", () => {
    expect(getBreadcrumb("/tesoreria/movimientos")).toEqual([
      { label: "Finanzas", href: "/tesoreria" },
      { label: "Tesorería", href: "/tesoreria" },
      { label: "Movimientos" },
    ]);
  });

  it("usa SEGMENT_LABELS para segmentos sueltos (nueva)", () => {
    expect(getBreadcrumb("/ventas/nueva")).toEqual([
      { label: "Comercial", href: "/ventas" },
      { label: "Ventas", href: "/ventas" },
      { label: "Nueva" },
    ]);
  });

  it("ruta desconocida → []", () => {
    expect(getBreadcrumb("/zzz")).toEqual([]);
  });
});
