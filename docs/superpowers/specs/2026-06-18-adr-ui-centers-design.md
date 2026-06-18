# ADR-UI — Navegación por centers (estilo NetSuite)

- **Fecha:** 2026-06-18
- **Estado:** aprobado por el dueño (brainstorming 2026-06-18)
- **Alcance:** Fase F · bloque NS-2 (navegación). Habilita NS-1/NS-3/NS-4/NS-5.
- **Notas relacionadas:** vault `20-plano-remake-uiux-netsuite` (NS-1…NS-5), `21-plano-consolidado-execucao` (Onda U), `15-proposta-netsuite`.

## Contexto

La UI actual usa una **sidebar plana** (`app-sidebar.tsx` + `nav-items.ts`, 4 grupos hardcodeados) sobre 94 páginas en 15 módulos. El objetivo de la Fase F es un ERP estilo NetSuite: navegación por **centers**, mega-menú, breadcrumb con código real, ⌘K, densidad compacta.

Hecho que define el diseño: el modelo de roles es binario (`Role { ADMIN, USER }`, `prisma/schema.prisma:17`) — **no hay roles funcionales** (vendedor, contador, operador comex). Por lo tanto los centers reflejan **áreas de trabajo funcionales**, no permisos; hoy todo usuario ve todo.

Stack ya presente (corrige la memoria que decía "campo verde"): Next 16 · React 19.2.7 · Tailwind v4 (CSS-first `@theme` con dark mode ya definido en `globals.css`) · shadcn v4 configurado (`components.json`, style `base-maia`, `@base-ui/react`, iconos `hugeicons`) · 31 componentes en `src/components/ui/` · `cmdk`/`@tanstack/react-table`/`next-themes` instalados pero subutilizados · **`nuqs` ausente**.

## Decisiones (tomadas en el brainstorming)

1. **Esquema de centers: A — ciclo operacional**, 7 centers + Configuración. Eje = flujo de la mercadería (comprar → importar → estocar → vender → cobrar → registrar).
2. **Mecanismo: topnav + mega-menú, sin sidebar.** Las hub pages pasan a ser overview del center. (NetSuite literal; mayor superficie de cambio, mitigada por feature-flag.)
3. **Configuración** (Maestros + Admin + Perfil) va en el **menú de usuario** (avatar), no en la barra de centers — patrón NetSuite "Setup".
4. **Gastos** → center **Finanzas** (no Compras). **Dashboard + BI** → center **Inicio** (no un center "Análisis").
5. **Estrategia de corte: feature-flag** (cookie `ui_nav`), default = sidebar actual, hasta validar.
6. Verificación visual: **Playwright** (gate por página, local) + **Chrome** (pasada final en preview Vercel).

## Mapa de centers → módulos → rutas

Las rutas **no cambian**. Cada center "posee" un conjunto de prefijos de ruta.

| Center | Módulos | Prefijos de ruta (canónicos) |
|---|---|---|
| **Inicio** | Dashboard, BI | `/dashboard`, `/bi` |
| **Comercial** | CRM, Ventas, Entregas | `/crm`, `/ventas`, `/entregas` |
| **Abastecimiento** | Compras | `/compras` |
| **Comex** | Embarques, Despachos, Contenedores, Desconsolidación, Investigación, Simulaciones, Proveedores-comex | `/comex` |
| **Inventario** | Inventario, Transferencias | `/inventario` |
| **Finanzas** | Tesorería, Gastos, Gastos fijos | `/tesoreria`, `/gastos`, `/gastos-fijos` |
| **Contabilidad** | Asientos, Cuentas, Períodos, Reportes | `/contabilidad`, `/reportes` |
| **Configuración** (menú de usuario) | Maestros, Admin, Perfil | `/maestros`, `/admin`, `/perfil` |

### Cross-links (atajo, no duplicación)

Los datos maestros viven en Configuración (`/maestros/*`) pero aparecen como **atajo** en los centers que los consumen — el link apunta a la ruta canónica:

- Comercial → Clientes (`/maestros/clientes`)
- Abastecimiento → Proveedores (`/maestros/proveedores`)
- Inventario → Productos (`/maestros/productos`), Depósitos (`/maestros/depositos`)
- Finanzas → Cotizaciones (`/maestros/cotizaciones`)

### Ambigüedades de ruta a resolver en `getCenterActivo`

- `/comex/.../proveedores` (proveedores-comex) ≠ `/maestros/proveedores`. El primero pertenece a Comex; el segundo a Configuración.
- `/ventas/[id]/entregas` pertenece a Comercial (sub-tab de la venta); `/entregas` (standalone) también a Comercial.
- El center activo se resuelve por **el prefijo más largo que matchea** el pathname.

## Arquitectura de componentes (3 unidades aisladas)

La separación dato / derivación / presentación es la clave para testear la lógica sin browser.

1. **`src/components/layout/nav-config.ts`** — dato puro. Estructura tipada:
   ```ts
   type NavItem = { label: string; href: string; icon: IconName; searchPrefix?: string }
   type NavSection = { label: string; items: NavItem[] }
   type Center = { id: CenterId; label: string; icon: IconName; overviewHref: string; routePrefixes: string[]; sections: NavSection[]; crossLinks?: NavItem[] }
   ```
   Fuente única que alimenta topnav, mega-menú, breadcrumb y ⌘K (NS-1). Reemplaza `nav-items.ts`. `searchPrefix` (ej. `em:`, `cl:`, `as:`) queda declarado acá para NS-2.

2. **`src/lib/nav/center-activo.ts`** — derivación pura, **sin React** (TDD puro):
   - `getCenterActivo(pathname): CenterId` — prefijo más largo.
   - `getBreadcrumb(pathname): Crumb[]` — center → módulo → record. Aquí vive el riesgo de "ruta huérfana": un test recorre las 94 rutas y exige que cada una resuelva a exactamente un center.

3. **Presentación** (client components):
   - `app-topnav.tsx` — barra de centers + estado de mega-menú abierto + acciones (⌘K, "+", notificaciones, avatar→Configuración).
   - `mega-menu.tsx` — panel del center (2-3 columnas: Operación / Gestión / Atajos), accesible vía primitivo `@base-ui/react` (Esc cierra, flechas, foco roving).
   - `nav-drawer.tsx` — móvil; reusa `sheet.tsx`.

**Modificados:** `(dashboard)/layout.tsx` (monta `AppTopnav` detrás de la flag; quita `SidebarProvider` en el cutover), `app-header.tsx` (breadcrumb prefijado con el center).
**Deprecados tras cutover:** `app-sidebar.tsx`, `nav-items.ts`.

## Estrategia de transición — "página por página, sin fallas"

El shell vive en el `layout (dashboard)` **único** que envuelve las 94 páginas → cambiarlo es **atómico**. Se mitiga con feature-flag.

- **PR-A — shell detrás de flag.** `nav-config` + `center-activo` (con tests) + `app-topnav` + `mega-menu` + `nav-drawer`, montados bajo cookie `ui_nav=topnav` (**default OFF = sidebar actual**). Impacto cero en prod. Verificación: Playwright recorre los 7 centers, abre cada mega-menú, y **confirma que las 94 rutas siguen alcanzables** (cruzando contra `nav-config`) + screenshots light/dark; Chrome en preview Vercel.
- **PR-B — cutover.** Flag default ON; se eliminan `SidebarProvider`/`app-sidebar`/`nav-items`. Pequeño y reversible (flag OFF = rollback instantáneo, sin revertir PR).
- **PR-C…N — overviews (acá sí, página por página).** Cada hub page (`/comex`, `/tesoreria`, `/ventas`…) pasa a ser overview del center — **un PR por center**, cada uno con su screenshot.

## Lo que NO cambia

Rutas, server actions, datos, los 31 componentes `ui/`. Solo la cáscara de navegación.

## Schema

**Ninguno.** Centers y navegación son código puro. `SavedView` (NS-3) y `User.dashboardConfig` (NS-5) entran en sus bloques — y cuando entren será vía `pnpm db:migrate` (Prisma Migrate, E13), **no `db push`**.

## Accesibilidad y móvil

- Mega-menú: navegación por teclado (Esc, flechas, foco), `aria-expanded`, `role="menu"`. Usar primitivo `@base-ui/react` antes que hand-roll.
- Móvil: la topnav colapsa a `nav-drawer` (Sheet). Plan móvil es parte del PR-A (no diferido) porque quitar la sidebar deja sin fallback en pantallas chicas.

## Gates y protocolo

1 etapa = 1 branch = 1 PR; gates `biome:ci` + `typecheck` + `test` (build solo si toca edge/proxy); TDD de `center-activo`; verificación Playwright; review adversarial (incl. `gsd-ui-auditor` 6 pilares); auto-merge squash; ☑ en la nota 20 del vault.

## Próximo paso

Plan de implementación del PR-A vía writing-plans.
