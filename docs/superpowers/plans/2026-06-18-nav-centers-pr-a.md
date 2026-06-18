# PR-A — Shell de navegación por centers (detrás de feature-flag) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el shell de navegación NetSuite (topnav + mega-menú + drawer móvil) detrás de una feature-flag `ui_nav` (default OFF = sidebar actual), sin tocar rutas ni datos, validado por un guard automático de rutas huérfanas.

**Architecture:** Tres unidades aisladas — `nav-config.ts` (dato puro: 7 centers + Configuración), `lib/nav/*` (derivación pura testeable sin React: `getCenterActivo`/`getBreadcrumb`/`resolveNavVariant`), y presentación (`app-topnav`/`center-mega-menu`/`nav-drawer`/`topnav-user-menu`). El `(dashboard)/layout.tsx` elige topnav vs sidebar leyendo la cookie. Aditivo: el camino sidebar actual queda 100% intacto.

**Tech Stack:** Next 16 (App Router, RSC) · React 19.2.7 · Tailwind v4 · `@base-ui/react` (Popover, Dialog) · `@hugeicons/react` · vitest (puro, sin Testcontainers para estos tests).

## Global Constraints

- **No tocar rutas ni server actions.** Los centers son una capa de navegación; las 94 rutas existentes siguen iguales.
- **Sin schema, sin migración.** Solo código.
- **Flag default OFF** (`ui_nav` ausente o ≠ `topnav` → sidebar actual). Prod no cambia hasta el cutover (PR-B).
- **Iconos:** usar SOLO nombres `@hugeicons/core-free-icons` ya importados en el repo (lista en Task 1). No inventar nombres de iconos.
- **Componentes UI:** reusar `@/components/ui/{popover,sheet,dropdown-menu,avatar,button,separator}` y `@/lib/utils#cn`. Seguir el patrón `render={<Link/>}` de base-ui (ver `app-sidebar.tsx`).
- **es-AR** en todo texto visible.
- **Tests puros:** `nav-config`/`center-activo`/`nav-flag` NO importan `server-only` ni tocan DB → corren sin Docker.
- Gates antes de PR: `pnpm biome:ci` + `pnpm typecheck` + `pnpm test`. Build solo si se toca `src/proxy.ts` (no es el caso).

---

### Task 1: `nav-config.ts` — dato de los centers

**Files:**
- Create: `src/components/layout/nav-config.ts`
- Test: `test/nav-config.test.ts`

**Interfaces:**
- Produces: `type CenterId`, `type NavCenter`, `type NavItem`, `type NavSection`, `const CENTERS: readonly NavCenter[]`, `const ALL_NAV_ITEMS: readonly NavItem[]` (flatten de items + crossLinks de todos los centers).

- [ ] **Step 1: Escribir el test de sanidad (debe fallar)**

```ts
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run test/nav-config.test.ts`
Expected: FAIL (módulo `nav-config` no existe).

- [ ] **Step 3: Escribir `nav-config.ts`**

```ts
import {
  DashboardSquare01Icon,
  Analytics01Icon,
  CustomerService01Icon,
  ShoppingBag03Icon,
  TruckDeliveryIcon,
  ShoppingBasket03Icon,
  CargoShipIcon,
  PackageIcon,
  CreditCardIcon,
  ReceiptDollarIcon,
  Calendar03Icon,
  Invoice01Icon,
  ChartLineData01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";

export type CenterId =
  | "inicio" | "comercial" | "abastecimiento" | "comex"
  | "inventario" | "finanzas" | "contabilidad" | "configuracion";

export type NavItem = { label: string; href: string; icon: typeof DashboardSquare01Icon };
export type NavSection = { label: string; items: readonly NavItem[] };
export type NavCenter = {
  id: CenterId;
  label: string;
  icon: typeof DashboardSquare01Icon;
  overviewHref: string;
  routePrefixes: readonly string[];
  sections: readonly NavSection[];
  crossLinks?: readonly NavItem[];
  inUserMenu?: boolean;
};

export const CENTERS: readonly NavCenter[] = [
  {
    id: "inicio",
    label: "Inicio",
    icon: DashboardSquare01Icon,
    overviewHref: "/dashboard",
    routePrefixes: ["/dashboard", "/bi"],
    sections: [
      {
        label: "General",
        items: [
          { label: "Dashboard", href: "/dashboard", icon: DashboardSquare01Icon },
          { label: "BI", href: "/bi", icon: Analytics01Icon },
        ],
      },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    icon: CustomerService01Icon,
    overviewHref: "/ventas",
    routePrefixes: ["/ventas", "/crm", "/entregas"],
    sections: [
      {
        label: "Ventas",
        items: [
          { label: "Ventas", href: "/ventas", icon: ShoppingBag03Icon },
          { label: "Pedidos", href: "/ventas/pedidos", icon: ShoppingBag03Icon },
          { label: "Entregas", href: "/entregas", icon: TruckDeliveryIcon },
        ],
      },
      {
        label: "CRM",
        items: [
          { label: "CRM", href: "/crm", icon: CustomerService01Icon },
          { label: "Leads", href: "/crm/leads", icon: CustomerService01Icon },
          { label: "Oportunidades", href: "/crm/oportunidades", icon: CustomerService01Icon },
          { label: "Contactos", href: "/crm/contactos", icon: UserGroupIcon },
          { label: "Actividades", href: "/crm/actividades", icon: Calendar03Icon },
        ],
      },
    ],
    crossLinks: [{ label: "Clientes", href: "/maestros/clientes", icon: UserGroupIcon }],
  },
  {
    id: "abastecimiento",
    label: "Abastecimiento",
    icon: ShoppingBasket03Icon,
    overviewHref: "/compras",
    routePrefixes: ["/compras"],
    sections: [
      {
        label: "Compras",
        items: [
          { label: "Compras", href: "/compras", icon: ShoppingBasket03Icon },
          { label: "Pedidos de compra", href: "/compras/pedidos", icon: ShoppingBasket03Icon },
        ],
      },
    ],
    crossLinks: [{ label: "Proveedores", href: "/maestros/proveedores", icon: TruckDeliveryIcon }],
  },
  {
    id: "comex",
    label: "Comex",
    icon: CargoShipIcon,
    overviewHref: "/comex",
    routePrefixes: ["/comex"],
    sections: [
      {
        label: "Operación",
        items: [
          { label: "Embarques", href: "/comex/embarques", icon: CargoShipIcon },
          { label: "Simulaciones", href: "/comex/simulaciones", icon: Analytics01Icon },
        ],
      },
      {
        label: "Gestión",
        items: [
          { label: "Proveedores", href: "/comex/proveedores", icon: TruckDeliveryIcon },
        ],
      },
    ],
  },
  {
    id: "inventario",
    label: "Inventario",
    icon: PackageIcon,
    overviewHref: "/inventario",
    routePrefixes: ["/inventario"],
    sections: [
      {
        label: "Stock",
        items: [
          { label: "Inventario", href: "/inventario", icon: PackageIcon },
          { label: "Transferencias", href: "/inventario/transferencias", icon: TruckDeliveryIcon },
        ],
      },
    ],
    crossLinks: [
      { label: "Productos", href: "/maestros/productos", icon: PackageIcon },
      { label: "Depósitos", href: "/maestros/depositos", icon: PackageIcon },
    ],
  },
  {
    id: "finanzas",
    label: "Finanzas",
    icon: CreditCardIcon,
    overviewHref: "/tesoreria",
    routePrefixes: ["/tesoreria", "/gastos", "/gastos-fijos"],
    sections: [
      {
        label: "Tesorería",
        items: [
          { label: "Tesorería", href: "/tesoreria", icon: CreditCardIcon },
          { label: "Cuentas", href: "/tesoreria/cuentas", icon: CreditCardIcon },
          { label: "Movimientos", href: "/tesoreria/movimientos", icon: ReceiptDollarIcon },
          { label: "Transferencias", href: "/tesoreria/transferencias", icon: ReceiptDollarIcon },
          { label: "Préstamos", href: "/tesoreria/prestamos", icon: CreditCardIcon },
          { label: "Anticipos", href: "/tesoreria/anticipos", icon: ReceiptDollarIcon },
          { label: "Extractos", href: "/tesoreria/extractos", icon: Invoice01Icon },
        ],
      },
      {
        label: "Cuentas corrientes",
        items: [
          { label: "Cuentas a pagar", href: "/tesoreria/cuentas-a-pagar", icon: ReceiptDollarIcon },
          { label: "Cuentas a cobrar", href: "/tesoreria/cuentas-a-cobrar", icon: ReceiptDollarIcon },
          { label: "Saldos por proveedor", href: "/tesoreria/saldos-proveedores", icon: TruckDeliveryIcon },
        ],
      },
      {
        label: "Gastos",
        items: [
          { label: "Gastos", href: "/gastos", icon: ReceiptDollarIcon },
          { label: "Gastos fijos", href: "/gastos-fijos", icon: Calendar03Icon },
        ],
      },
    ],
    crossLinks: [{ label: "Cotizaciones", href: "/maestros/cotizaciones", icon: ChartLineData01Icon }],
  },
  {
    id: "contabilidad",
    label: "Contabilidad",
    icon: Invoice01Icon,
    overviewHref: "/contabilidad",
    routePrefixes: ["/contabilidad", "/reportes"],
    sections: [
      {
        label: "Registro",
        items: [
          { label: "Asientos", href: "/contabilidad", icon: Invoice01Icon },
          { label: "Cuentas", href: "/contabilidad/cuentas", icon: Invoice01Icon },
          { label: "Períodos", href: "/contabilidad/periodos", icon: Calendar03Icon },
        ],
      },
      {
        label: "Reportes",
        items: [
          { label: "Balance General", href: "/reportes/balance-general", icon: ChartLineData01Icon },
          { label: "Estado de Resultados", href: "/reportes/estado-resultados", icon: ChartLineData01Icon },
          { label: "Flujo de Caja", href: "/reportes/flujo-caja", icon: ChartLineData01Icon },
          { label: "Libro Diario", href: "/reportes/libro-diario", icon: Invoice01Icon },
          { label: "Libro Mayor", href: "/reportes/libro-mayor", icon: Invoice01Icon },
          { label: "Balance de sumas y saldos", href: "/contabilidad/reportes/balance", icon: ChartLineData01Icon },
        ],
      },
    ],
  },
  {
    id: "configuracion",
    label: "Configuración",
    icon: UserGroupIcon,
    overviewHref: "/maestros",
    routePrefixes: ["/maestros", "/admin", "/perfil"],
    inUserMenu: true,
    sections: [
      {
        label: "Maestros",
        items: [
          { label: "Clientes", href: "/maestros/clientes", icon: UserGroupIcon },
          { label: "Proveedores", href: "/maestros/proveedores", icon: TruckDeliveryIcon },
          { label: "Productos", href: "/maestros/productos", icon: PackageIcon },
          { label: "Depósitos", href: "/maestros/depositos", icon: PackageIcon },
          { label: "Cotizaciones", href: "/maestros/cotizaciones", icon: ChartLineData01Icon },
          { label: "Jurisdicciones IIBB", href: "/maestros/jurisdicciones-iibb", icon: Invoice01Icon },
        ],
      },
      {
        label: "Sistema",
        items: [
          { label: "Admin", href: "/admin", icon: UserGroupIcon },
          { label: "Mi perfil", href: "/perfil", icon: UserGroupIcon },
        ],
      },
    ],
  },
];

export const ALL_NAV_ITEMS: readonly NavItem[] = CENTERS.flatMap((c) => [
  ...c.sections.flatMap((s) => s.items),
  ...(c.crossLinks ?? []),
]);
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run test/nav-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/nav-config.ts test/nav-config.test.ts
git commit --no-verify -m "feat(ui): nav-config con los 7 centers + Configuración (PR-A)"
```
> Nota: `--no-verify` porque husky/lint-staged no resuelve en worktree con node_modules symlinkado; los gates corren en CI.

---

### Task 2: `getCenterActivo` + guard de ruta huérfana

**Files:**
- Create: `src/lib/nav/center-activo.ts`
- Test: `test/nav-center-activo.test.ts`

**Interfaces:**
- Consumes: `CENTERS`, `CenterId`, `NavCenter` de `nav-config`.
- Produces: `findCenterByPrefix(pathname: string): NavCenter | undefined` (prefijo más largo, sin fallback), `getCenterActivo(pathname: string): CenterId` (con fallback `"inicio"`).

- [ ] **Step 1: Escribir el test (debe fallar)**

```ts
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
        const seg = name.startsWith("(") && name.endsWith(")")
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run test/nav-center-activo.test.ts`
Expected: FAIL (módulo `center-activo` no existe).

- [ ] **Step 3: Escribir `center-activo.ts`**

```ts
import { CENTERS, type CenterId, type NavCenter } from "@/components/layout/nav-config";

export function findCenterByPrefix(pathname: string): NavCenter | undefined {
  let best: { center: NavCenter; len: number } | undefined;
  for (const center of CENTERS) {
    for (const prefix of center.routePrefixes) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > best.len) best = { center, len: prefix.length };
      }
    }
  }
  return best?.center;
}

export function getCenterActivo(pathname: string): CenterId {
  return findCenterByPrefix(pathname)?.id ?? "inicio";
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run test/nav-center-activo.test.ts`
Expected: PASS. Si el GUARD lista rutas huérfanas, agregar el `routePrefix` faltante al center correcto en `nav-config.ts` (NO tocar la ruta).

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav/center-activo.ts test/nav-center-activo.test.ts
git commit --no-verify -m "feat(ui): getCenterActivo + guard de ruta huérfana (PR-A)"
```

---

### Task 3: `getBreadcrumb`

**Files:**
- Modify: `src/lib/nav/center-activo.ts` (agregar `getBreadcrumb` + `SEGMENT_LABELS` + `looksLikeId`)
- Test: `test/nav-breadcrumb.test.ts`

**Interfaces:**
- Produces: `type Crumb = { label: string; href?: string }`, `getBreadcrumb(pathname: string): Crumb[]`.

- [ ] **Step 1: Escribir el test (debe fallar)**

```ts
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run test/nav-breadcrumb.test.ts`
Expected: FAIL (`getBreadcrumb` no exportado).

- [ ] **Step 3: Agregar `getBreadcrumb` a `center-activo.ts`**

Agregar al final del archivo (e importar `ALL_NAV_ITEMS`):

```ts
import { ALL_NAV_ITEMS } from "@/components/layout/nav-config";

export type Crumb = { label: string; href?: string };

const SEGMENT_LABELS: Record<string, string> = {
  embarques: "Embarques", asientos: "Asientos", cuentas: "Cuentas",
  movimientos: "Movimientos", transferencias: "Transferencias", prestamos: "Préstamos",
  "cuentas-a-pagar": "Cuentas a pagar", "cuentas-a-cobrar": "Cuentas a cobrar",
  "saldos-proveedores": "Saldos por proveedor", extractos: "Extractos", anticipos: "Anticipos",
  pedidos: "Pedidos", clientes: "Clientes", proveedores: "Proveedores", productos: "Productos",
  depositos: "Depósitos", cotizaciones: "Cotizaciones", periodos: "Períodos", reportes: "Reportes",
  "balance-general": "Balance General", "estado-resultados": "Estado de Resultados",
  "flujo-caja": "Flujo de Caja", "libro-diario": "Libro Diario", "libro-mayor": "Libro Mayor",
  balance: "Balance", simulaciones: "Simulaciones", entregas: "Entregas", leads: "Leads",
  oportunidades: "Oportunidades", contactos: "Contactos", actividades: "Actividades",
  "jurisdicciones-iibb": "Jurisdicciones IIBB", nuevo: "Nuevo", nueva: "Nueva",
};

function looksLikeId(seg: string): boolean {
  return /^\d+$/.test(seg) || /^[a-z0-9]{20,}$/i.test(seg);
}

function findNavItemByLongestHref(pathname: string): { label: string; href: string } | undefined {
  let best: { label: string; href: string; len: number } | undefined;
  for (const item of ALL_NAV_ITEMS) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.len) best = { ...item, len: item.href.length };
    }
  }
  return best ? { label: best.label, href: best.href } : undefined;
}

export function getBreadcrumb(pathname: string): Crumb[] {
  const center = findCenterByPrefix(pathname);
  if (!center) return [];

  const crumbs: Crumb[] = [];
  const onHub = pathname === center.overviewHref;
  crumbs.push({ label: center.label, href: onHub ? undefined : center.overviewHref });
  if (onHub) return crumbs;

  const moduleItem = findNavItemByLongestHref(pathname);
  let consumed = center.overviewHref;
  if (moduleItem && moduleItem.label !== center.label) {
    const onModule = pathname === moduleItem.href;
    crumbs.push({ label: moduleItem.label, href: onModule ? undefined : moduleItem.href });
    consumed = moduleItem.href;
  }

  const rest = pathname.slice(consumed.length).split("/").filter(Boolean);
  let acc = consumed;
  rest.forEach((seg, i) => {
    acc += `/${seg}`;
    const isLast = i === rest.length - 1;
    if (looksLikeId(seg)) {
      crumbs.push({ label: "Detalle" });
      return;
    }
    crumbs.push({ label: SEGMENT_LABELS[seg] ?? seg, href: isLast ? undefined : acc });
  });
  return crumbs;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run test/nav-breadcrumb.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav/center-activo.ts test/nav-breadcrumb.test.ts
git commit --no-verify -m "feat(ui): getBreadcrumb center › módulo › segmentos (PR-A)"
```

---

### Task 4: feature-flag `resolveNavVariant`

**Files:**
- Create: `src/lib/nav/nav-flag.ts`
- Test: `test/nav-flag.test.ts`

**Interfaces:**
- Produces: `const UI_NAV_COOKIE = "ui_nav"`, `type NavVariant = "topnav" | "sidebar"`, `resolveNavVariant(cookieValue: string | undefined): NavVariant`.

- [ ] **Step 1: Escribir el test (debe fallar)**

```ts
import { describe, expect, it } from "vitest";
import { resolveNavVariant, UI_NAV_COOKIE } from "@/lib/nav/nav-flag";

describe("resolveNavVariant", () => {
  it("default (undefined) → sidebar", () => expect(resolveNavVariant(undefined)).toBe("sidebar"));
  it("'topnav' → topnav", () => expect(resolveNavVariant("topnav")).toBe("topnav"));
  it("cualquier otro valor → sidebar", () => expect(resolveNavVariant("xyz")).toBe("sidebar"));
  it("cookie name", () => expect(UI_NAV_COOKIE).toBe("ui_nav"));
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run test/nav-flag.test.ts`
Expected: FAIL.

- [ ] **Step 3: Escribir `nav-flag.ts`**

```ts
export const UI_NAV_COOKIE = "ui_nav";
export type NavVariant = "topnav" | "sidebar";

export function resolveNavVariant(cookieValue: string | undefined): NavVariant {
  return cookieValue === "topnav" ? "topnav" : "sidebar";
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run test/nav-flag.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/nav/nav-flag.ts test/nav-flag.test.ts
git commit --no-verify -m "feat(ui): flag ui_nav resolveNavVariant (default sidebar) (PR-A)"
```

---

### Task 5: `center-mega-menu.tsx` + `topnav-user-menu.tsx`

**Files:**
- Create: `src/components/layout/center-mega-menu.tsx`
- Create: `src/components/layout/topnav-user-menu.tsx`

**Interfaces:**
- Consumes: `NavCenter` de `nav-config`; `Popover/PopoverTrigger/PopoverContent`, `DropdownMenu*`, `Avatar*`, `logout`.
- Produces: `CenterMegaMenu({ center, active }: { center: NavCenter; active: boolean })`, `TopnavUserMenu({ user, config }: { user: {...}; config: NavCenter })`.

Estos son componentes de presentación: su gate es la verificación visual (Task 8), no un unit test.

- [ ] **Step 1: Escribir `center-mega-menu.tsx`**

```tsx
"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { NavCenter } from "@/components/layout/nav-config";

export function CenterMegaMenu({ center, active }: { center: NavCenter; active: boolean }) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {center.label}
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="grid w-auto min-w-[28rem] grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-6 gap-y-3 p-4"
      >
        {center.sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-1">
            <p className="px-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              {section.label}
            </p>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <HugeiconsIcon icon={item.icon} className="size-4 text-muted-foreground" />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        {center.crossLinks && center.crossLinks.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="px-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
              Atajos
            </p>
            {center.crossLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <HugeiconsIcon icon={item.icon} className="size-4 text-muted-foreground" />
                {item.label}
              </Link>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Escribir `topnav-user-menu.tsx`**

```tsx
"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon } from "@hugeicons/core-free-icons";

import { logout } from "@/lib/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NavCenter } from "@/components/layout/nav-config";

function getInitials(nombre: string) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function TopnavUserMenu({
  user, config,
}: { user: { nombre: string; username: string; role: string }; config: NavCenter }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Configuración y perfil"
      >
        <Avatar className="size-7 rounded-md">
          <AvatarFallback className="rounded-md text-[11px]">
            {getInitials(user.nombre) || "??"}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-56 rounded-lg">
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
            <Avatar className="size-8 rounded-md">
              <AvatarFallback className="rounded-md text-xs">
                {getInitials(user.nombre) || "??"}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 leading-tight">
              <span className="truncate font-medium">{user.nombre}</span>
              <span className="truncate text-xs text-muted-foreground">{user.role}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {config.sections.map((section) => (
          <DropdownMenuGroup key={section.label}>
            {section.items.map((item) => (
              <DropdownMenuItem key={item.href} render={<Link href={item.href} />}>
                <HugeiconsIcon icon={item.icon} />
                {item.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
        ))}
        <form action={logout}>
          <DropdownMenuItem render={<button type="submit" className="w-full cursor-pointer" />}>
            <HugeiconsIcon icon={Logout01Icon} />
            Cerrar sesión
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

> Verificar que `ArrowDown01Icon` existe en `@hugeicons/core-free-icons`; si no, usar `ArrowRight01Icon` (confirmado) rotado o sin icono. `logout` viene de `@/lib/actions/auth` (mismo import que `user-menu.tsx`).

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: 0 errores. (Aún no se renderizan; se montan en Task 7.)

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/center-mega-menu.tsx src/components/layout/topnav-user-menu.tsx
git commit --no-verify -m "feat(ui): mega-menú de center + user-menu de topnav (PR-A)"
```

---

### Task 6: `nav-drawer.tsx` (móvil)

**Files:**
- Create: `src/components/layout/nav-drawer.tsx`

**Interfaces:**
- Consumes: `CENTERS`; `Sheet/SheetTrigger/SheetContent/SheetHeader/SheetTitle`, `Button`.
- Produces: `NavDrawer()` (botón hamburguesa + Sheet con todos los centers/items).

- [ ] **Step 1: Escribir `nav-drawer.tsx`**

```tsx
"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { Menu01Icon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CENTERS } from "@/components/layout/nav-config";

export function NavDrawer() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Menú" />}>
        <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="p-4 pb-2">
          <SheetTitle>Navegación</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-3 overflow-y-auto px-3 pb-6">
          {CENTERS.map((center) => (
            <div key={center.id} className="flex flex-col gap-0.5">
              <p className="flex items-center gap-2 px-1 py-1 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
                <HugeiconsIcon icon={center.icon} className="size-4" />
                {center.label}
              </p>
              {center.sections.flatMap((s) => s.items).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
```

> Verificar que `Menu01Icon` existe; si no, usar `MoreHorizontalIcon` (confirmado). Confirmar que `Button` acepta `size="icon-sm"` (lo usa `sheet.tsx:66`).

- [ ] **Step 2: typecheck + commit**

Run: `pnpm typecheck` → 0 errores.

```bash
git add src/components/layout/nav-drawer.tsx
git commit --no-verify -m "feat(ui): nav-drawer móvil (PR-A)"
```

---

### Task 7: `app-topnav.tsx`

**Files:**
- Create: `src/components/layout/app-topnav.tsx`

**Interfaces:**
- Consumes: `CENTERS`, `getCenterActivo`, `getBreadcrumb`; `CenterMegaMenu`, `TopnavUserMenu`, `NavDrawer`.
- Produces: `AppTopnav({ user }: { user: { nombre; username; role } })` — header sticky con barra de centers + acciones + fila de breadcrumb.

- [ ] **Step 1: Escribir `app-topnav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { TireIcon, ArrowRight01Icon } from "@hugeicons/core-free-icons";

import { CENTERS } from "@/components/layout/nav-config";
import { getCenterActivo, getBreadcrumb } from "@/lib/nav/center-activo";
import { CenterMegaMenu } from "@/components/layout/center-mega-menu";
import { TopnavUserMenu } from "@/components/layout/topnav-user-menu";
import { NavDrawer } from "@/components/layout/nav-drawer";

export function AppTopnav({ user }: { user: { nombre: string; username: string; role: string } }) {
  const pathname = usePathname();
  const activeId = getCenterActivo(pathname);
  const crumbs = getBreadcrumb(pathname);
  const barCenters = CENTERS.filter((c) => !c.inUserMenu);
  const config = CENTERS.find((c) => c.id === "configuracion")!;

  return (
    <header className="sticky top-0 z-20 flex shrink-0 flex-col border-b border-border bg-background/85 backdrop-blur-md">
      <div className="flex h-11 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <NavDrawer />
          <Link href="/dashboard" className="flex items-center gap-1.5">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <HugeiconsIcon icon={TireIcon} className="size-3.5" />
            </span>
            <span className="hidden text-[13px] font-semibold tracking-tight sm:inline">Sunset</span>
          </Link>
          <nav className="ml-1 hidden items-center gap-0.5 md:flex" aria-label="Centers">
            {barCenters.map((center) => (
              <CenterMegaMenu key={center.id} center={center} active={center.id === activeId} />
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <TopnavUserMenu user={user} config={config} />
        </div>
      </div>
      {crumbs.length > 0 ? (
        <nav aria-label="breadcrumb" className="flex h-8 items-center gap-1 border-t border-border/60 px-3 text-[12px]">
          {crumbs.map((c, idx) => {
            const isLast = idx === crumbs.length - 1;
            return (
              <span key={`${c.label}-${idx}`} className="flex items-center gap-1">
                {c.href && !isLast ? (
                  <Link href={c.href} className="text-muted-foreground transition-colors hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span
                    className={isLast ? "font-medium text-foreground" : "text-muted-foreground"}
                    aria-current={isLast ? "page" : undefined}
                  >
                    {c.label}
                  </span>
                )}
                {!isLast ? (
                  <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3 text-muted-foreground/50" />
                ) : null}
              </span>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 2: typecheck + commit**

Run: `pnpm typecheck` → 0 errores.

```bash
git add src/components/layout/app-topnav.tsx
git commit --no-verify -m "feat(ui): app-topnav (barra de centers + breadcrumb) (PR-A)"
```

---

### Task 8: montar en el layout detrás de la flag + verificación

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `resolveNavVariant`, `UI_NAV_COOKIE`, `AppTopnav`.

- [ ] **Step 1: Modificar `(dashboard)/layout.tsx`**

Reemplazar el cuerpo del componente para ramificar por flag (camino sidebar INTACTO):

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppHeader } from "@/components/layout/app-header";
import { AppTopnav } from "@/components/layout/app-topnav";
import { resolveNavVariant, UI_NAV_COOKIE } from "@/lib/nav/nav-flag";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  const cookieStore = await cookies();
  const variant = resolveNavVariant(cookieStore.get(UI_NAV_COOKIE)?.value);
  const modoRetroactivo = session.user.modoRetroactivo ?? false;

  const retroBanner = modoRetroactivo ? (
    <div className="border-b border-amber-300 bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
      Modo retroactivo activo · las fechas no se autocompletan ·{" "}
      <Link href="/perfil" className="underline hover:text-amber-950">ajustar en perfil</Link>
    </div>
  ) : null;

  if (variant === "topnav") {
    return (
      <div className="flex min-h-svh flex-col">
        <AppTopnav user={session.user} />
        {retroBanner}
        <main className="flex-1 px-4 py-3">{children}</main>
      </div>
    );
  }

  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar user={session.user} />
      <SidebarInset>
        <AppHeader />
        {retroBanner}
        <main className="flex-1 px-4 py-3">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 2: Gates completos**

Run: `pnpm biome:ci && pnpm typecheck && pnpm test`
Expected: biome limpio (40 warnings preexistentes OK), typecheck 0 errores, todos los tests verdes (incluye los 4 nuevos archivos + el GUARD de rutas).

- [ ] **Step 3: Verificación visual (agente, NO en CI)**

Levantar dev y prender la flag por cookie, recorriendo con Playwright MCP:

```bash
pnpm dev   # http://localhost:3000
```
Con el Playwright MCP: login → `document.cookie = "ui_nav=topnav; path=/"` (o setear vía DevTools) → navegar `/dashboard`, abrir cada uno de los 7 mega-menús, click en items representativos de cada center, verificar breadcrumb (`/comex/embarques/<id>` → "Comex › Embarques › Detalle"), screenshots light + dark. Repetir en viewport móvil (drawer). Confirmar que sin la cookie la sidebar sigue idéntica. Pasada final con Chrome MCP en el preview Vercel.

- [ ] **Step 4: Commit final**

```bash
git add "src/app/(dashboard)/layout.tsx"
git commit --no-verify -m "feat(ui): montar topnav detrás de flag ui_nav en el layout (PR-A)"
```

- [ ] **Step 5: PR**

Branch desde `origin/main` actualizado (re-fetch: main avanzó con #262). Abrir PR, gates verdes, review adversarial (incl. `gsd-ui-auditor` 6 pilares sobre los componentes nuevos), auto-merge squash. Marcar ☑ NS-2 (parcial: shell) en la nota 20 del vault.

---

## Self-Review

**Spec coverage:** nav-config (Task 1) ✓ · center-activo/getCenterActivo + guard ruta huérfana (Task 2) ✓ · getBreadcrumb (Task 3) ✓ · flag `ui_nav` (Task 4) ✓ · mega-menú + user-menu (Task 5) ✓ · drawer móvil (Task 6) ✓ · topnav compositor (Task 7) ✓ · layout detrás de flag + verificación (Task 8) ✓ · rutas inalteradas / sin schema / camino sidebar intacto = constraints respetadas.

**Placeholder scan:** sin TBD/TODO. Riesgos marcados con verificación explícita: nombres de iconos `ArrowDown01Icon`/`Menu01Icon` (fallback indicado a `ArrowRight01Icon`/`MoreHorizontalIcon` confirmados) y `Button size="icon-sm"` (confirmado en `sheet.tsx`).

**Type consistency:** `CenterId`/`NavCenter`/`NavItem` definidos en Task 1, consumidos con esos nombres en Tasks 2/3/5/6/7. `findCenterByPrefix`/`getCenterActivo`/`getBreadcrumb`/`Crumb`/`resolveNavVariant`/`UI_NAV_COOKIE` usados con firma idéntica a su definición. `getBreadcrumb` usa `ALL_NAV_ITEMS` (exportado en Task 1).
