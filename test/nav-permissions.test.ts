import { describe, expect, it } from "vitest";
import { DashboardSquare01Icon } from "@hugeicons/core-free-icons";

import { CENTERS, type NavCenter } from "@/components/layout/nav-config";
import { SHELL_MODULES, type ShellModule } from "@/components/layout/nav-model";
import { PERMISOS } from "@/lib/permisos-catalog";
import {
  filterCentersByPermission,
  filterModulesByPermission,
  hasClientPermission,
} from "@/components/layout/nav-permissions";

describe("hasClientPermission", () => {
  it("sin RBAC resuelto (undefined) permite cualquier clave — garantía backward-compat", () => {
    expect(hasClientPermission(undefined, "admin.acceso")).toBe(true);
    expect(hasClientPermission(undefined, "cualquier.cosa")).toBe(true);
  });

  it("snapshot vacío niega todo", () => {
    expect(hasClientPermission([], "admin.acceso")).toBe(false);
  });

  it("exige la clave en el snapshot", () => {
    expect(hasClientPermission(["admin.acceso"], "admin.acceso")).toBe(true);
    expect(hasClientPermission(["admin.acceso"], "otra.clave")).toBe(false);
  });
});

function findItem(centers: readonly NavCenter[], href: string) {
  return centers.flatMap((c) => c.sections.flatMap((s) => s.items)).find((i) => i.href === href);
}

describe("filterCentersByPermission", () => {
  it("con permisos undefined devuelve el nav intacto (misma referencia, cero regresión)", () => {
    const result = filterCentersByPermission(CENTERS, undefined);
    expect(result).toBe(CENTERS);
    expect(findItem(result, "/admin")).toBeDefined();
  });

  it("sin admin.acceso oculta el ítem Admin pero mantiene Mi perfil y Configuración", () => {
    const result = filterCentersByPermission(CENTERS, [PERMISOS.APP_ACCESO]);
    expect(findItem(result, "/admin")).toBeUndefined();
    expect(findItem(result, "/perfil")).toBeDefined();
    expect(result.find((c) => c.id === "configuracion")).toBeDefined();
  });

  it("con admin.acceso el ítem Admin permanece visible", () => {
    const result = filterCentersByPermission(CENTERS, [PERMISOS.APP_ACCESO, PERMISOS.ADMIN_ACCESO]);
    expect(findItem(result, "/admin")).toBeDefined();
  });

  it("elimina un center totalmente gateado y conserva el íntegro cuando hay permiso", () => {
    const fixture: NavCenter[] = [
      {
        id: "configuracion",
        label: "Solo Admin",
        icon: DashboardSquare01Icon,
        overviewHref: "/x",
        routePrefixes: ["/x"],
        sections: [
          {
            label: "Restringido",
            items: [
              {
                label: "A",
                href: "/x/a",
                icon: DashboardSquare01Icon,
                permission: PERMISOS.ADMIN_ACCESO,
              },
              {
                label: "B",
                href: "/x/b",
                icon: DashboardSquare01Icon,
                permission: PERMISOS.ADMIN_ACCESO,
              },
            ],
          },
        ],
      },
    ];
    expect(filterCentersByPermission(fixture, [PERMISOS.APP_ACCESO])).toHaveLength(0);

    const allowed = filterCentersByPermission(fixture, [PERMISOS.ADMIN_ACCESO]);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].sections[0].items).toHaveLength(2);
  });

  it("una sección que queda sin ítems no aparece en el resultado", () => {
    const fixture: NavCenter[] = [
      {
        id: "comercial",
        label: "Mixto",
        icon: DashboardSquare01Icon,
        overviewHref: "/y",
        routePrefixes: ["/y"],
        sections: [
          {
            label: "Visible",
            items: [{ label: "Libre", href: "/y/libre", icon: DashboardSquare01Icon }],
          },
          {
            label: "Oculta",
            items: [
              {
                label: "Restr",
                href: "/y/restr",
                icon: DashboardSquare01Icon,
                permission: PERMISOS.ADMIN_ACCESO,
              },
            ],
          },
        ],
      },
    ];
    const result = filterCentersByPermission(fixture, [PERMISOS.APP_ACCESO]);
    expect(result).toHaveLength(1);
    expect(result[0].sections).toHaveLength(1);
    expect(result[0].sections[0].label).toBe("Visible");
  });
});

function findModItem(modules: readonly ShellModule[], href: string) {
  return modules.flatMap((m) => m.items ?? []).find((i) => i.href === href);
}

describe("filterModulesByPermission (top-nav, PR-015)", () => {
  it("con permisos undefined devuelve el top-nav intacto (misma referencia, cero regresión)", () => {
    const result = filterModulesByPermission(SHELL_MODULES, undefined);
    expect(result).toBe(SHELL_MODULES);
    expect(findModItem(result, "/sistema/usuarios")).toBeDefined();
  });

  it("sin permisos de sistema oculta los ítems gateados y conserva los libres", () => {
    const result = filterModulesByPermission(SHELL_MODULES, [PERMISOS.APP_ACCESO]);
    expect(findModItem(result, "/sistema/usuarios")).toBeUndefined(); // ADMIN_ACCESO
    expect(findModItem(result, "/sistema/aprobaciones")).toBeUndefined(); // APROBACIONES_VER
    expect(findModItem(result, "/sistema/auditoria")).toBeUndefined(); // AUDITORIA_VER
    expect(findModItem(result, "/admin/recalcular-percepcion-iibb")).toBeUndefined(); // ADMIN_ACCESO
    expect(findModItem(result, "/perfil")).toBeDefined(); // sin gate
  });

  it("con los permisos correctos los ítems gateados permanecen visibles", () => {
    const result = filterModulesByPermission(SHELL_MODULES, [
      PERMISOS.ADMIN_ACCESO,
      PERMISOS.AUDITORIA_VER,
      PERMISOS.APROBACIONES_VER,
    ]);
    expect(findModItem(result, "/sistema/usuarios")).toBeDefined();
    expect(findModItem(result, "/sistema/aprobaciones")).toBeDefined();
    expect(findModItem(result, "/sistema/auditoria")).toBeDefined();
  });

  it("los módulos-folha (sin items, ej. Dashboard/BI) siempre pasan", () => {
    const result = filterModulesByPermission(SHELL_MODULES, [PERMISOS.APP_ACCESO]);
    expect(result.find((m) => m.label === "Dashboard")).toBeDefined();
    expect(result.find((m) => m.label === "BI")).toBeDefined();
  });

  it("un módulo-pai totalmente gateado se elimina; con permiso se conserva íntegro", () => {
    const fixture: ShellModule[] = [
      {
        label: "Solo Admin",
        items: [
          { label: "A", href: "/x/a", status: "active", permission: PERMISOS.ADMIN_ACCESO },
          { label: "B", href: "/x/b", status: "active", permission: PERMISOS.ADMIN_ACCESO },
        ],
      },
    ];
    expect(filterModulesByPermission(fixture, [PERMISOS.APP_ACCESO])).toHaveLength(0);

    const allowed = filterModulesByPermission(fixture, [PERMISOS.ADMIN_ACCESO]);
    expect(allowed).toHaveLength(1);
    expect(allowed[0].items).toHaveLength(2);
  });
});
