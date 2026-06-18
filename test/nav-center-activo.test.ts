import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCenterByPrefix, getCenterActivo } from "@/lib/nav/center-activo";

describe("getCenterActivo", () => {
  it.each([
    ["/dashboard", "inicio"],
    ["/bi", "inicio"],
    ["/ventas", "comercial"],
    ["/ventas/123/entregas", "comercial"],
    ["/entregas", "comercial"],
    ["/crm/leads", "comercial"],
    ["/compras/nueva", "abastecimiento"],
    ["/comex/embarques", "comex"],
    ["/comex/proveedores", "comex"],
    ["/inventario/transferencias/nueva", "inventario"],
    ["/tesoreria/movimientos", "finanzas"],
    ["/gastos", "finanzas"],
    ["/gastos-fijos", "finanzas"],
    ["/contabilidad/asientos/9", "contabilidad"],
    ["/reportes/flujo-caja", "contabilidad"],
    ["/maestros/proveedores", "configuracion"],
    ["/admin/recalcular-percepcion-iibb", "configuracion"],
    ["/perfil", "configuracion"],
  ])("%s → %s", (path, expected) => {
    expect(getCenterActivo(path)).toBe(expected);
  });

  it("desambigua /comex/proveedores (Comex) vs /maestros/proveedores (Configuración)", () => {
    expect(findCenterByPrefix("/comex/proveedores")?.id).toBe("comex");
    expect(findCenterByPrefix("/maestros/proveedores")?.id).toBe("configuracion");
  });

  it("ruta desconocida → fallback inicio, pero findCenterByPrefix=undefined", () => {
    expect(findCenterByPrefix("/zzz-inexistente")).toBeUndefined();
    expect(getCenterActivo("/zzz-inexistente")).toBe("inicio");
  });

  it("GUARD: toda ruta real del (dashboard) resuelve a un center", () => {
    const root = join(process.cwd(), "src/app/(dashboard)");
    const rutas: string[] = [];
    const walk = (dir: string, urlSegs: string[]) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const name = ent.name;
        if (name.startsWith("@")) continue; // parallel routes
        const seg =
          name.startsWith("(") && name.endsWith(")")
            ? null // route group: no agrega segmento
            : name.startsWith("[")
              ? "1" // dinámico → placeholder
              : name;
        const next = seg === null ? urlSegs : [...urlSegs, seg];
        const hasPage = readdirSync(join(dir, name)).some((f) => /^page\.(tsx|ts|jsx|js)$/.test(f));
        if (hasPage && (seg !== null || urlSegs.length > 0)) rutas.push(`/${next.join("/")}`);
        walk(join(dir, name), next);
      }
    };
    walk(root, []);
    expect(rutas.length).toBeGreaterThan(20);
    const huerfanas = rutas.filter((r) => findCenterByPrefix(r) === undefined);
    expect(huerfanas, `rutas sin center: ${huerfanas.join(", ")}`).toEqual([]);
  });
});
