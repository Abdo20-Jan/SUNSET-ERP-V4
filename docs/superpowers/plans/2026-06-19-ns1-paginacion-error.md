# NS-1 resto — Paginación universal + Error boundaries por módulo

> **For agentic workers:** Implementación vía Workflow (ultracode) — implement→review por ítem, gates+commit+PR los consolida el controlador.

**Goal:** Cerrar el bloque NS-1 de la Fase F: paginación server-side en las listas que aún no la tienen (reusando la infra existente) y un boundary de error reutilizable por módulo.

**Architecture:** La paginación NO construye nada nuevo: reusa `<Pagination>` + `parsePaginationParams` (`src/components/ui/pagination.tsx` / `pagination-params.ts`), ya probados en Ventas/Compras/Embarques. Los errores generalizan el único `error.tsx` existente (comex) a un componente compartido `<RouteError>` con helper puro testeable.

**Tech Stack:** Next.js 16 App Router/RSC, Prisma 7.8, vitest (node-only → solo helpers puros son unit-testables), @hugeicons, shadcn/base-ui.

## Global Constraints

- Reusar SIEMPRE `<Pagination page perPage total />` y `parsePaginationParams(params)`. Default `perPage = 50`. El componente ya preserva todos los `searchParams` (moneda, filtros) — NO reimplementar preservación.
- Cualquier contador del header (total, emitidas, contabilizados…) debe venir de un `count`/`groupBy` sobre el **set filtrado completo**, NUNCA de `rows.length` de la página.
- `export const dynamic = "force-dynamic"` ya está en las 5 páginas — mantenerlo.
- Code-only. Sin cambios de schema. Sin tocar las tablas client (`*-table.tsx`) salvo que reciban `total` (no lo necesitan).
- Maestros (productos/clientes/proveedores) quedan FUERA (búsqueda client-side → NS-3).
- Refs simbólicas del registry (ULTRA) donde aplique; acá no hay literales de cuentas.

---

## Referencia canónica (copiar el patrón)

`src/app/(dashboard)/compras/page.tsx` (listarCompras + `<Pagination ... className="border-t" />` dentro del `<Card className="py-0">`, header usando `total`).

---

### Task 1: Componente `<RouteError>` + helper + error.tsx por módulo

**Files:**
- Create: `src/lib/route-error.ts` (helper puro)
- Create: `test/route-error.test.ts`
- Create: `src/components/route-error.tsx` (client)
- Create: `src/app/(dashboard)/error.tsx` (fallback del grupo)
- Create: `src/app/global-error.tsx` (sobre el root layout — inline styles, SIN Tailwind)
- Create por módulo: `src/app/(dashboard)/{bi,compras,contabilidad,crm,entregas,gastos,gastos-fijos,inventario,maestros,reportes,tesoreria,ventas}/error.tsx`
- Modify: `src/app/(dashboard)/comex/error.tsx` → reusar `<RouteError>`

**Spec:**
- `classifyRouteError(message: string | undefined): "schema" | "generic"` — `schema` si el mensaje (lowercased) contiene `column` + `does not exist`, o `p2022`; si no, `generic`. `undefined` → `generic`.
- `<RouteError error reset titulo? modulo?>`: `console.error` con label de módulo en `useEffect`; Card + CardContent; `titulo` (default "No se pudo cargar la página"); si kind `schema` → texto explicando migración pendiente (mencionar el flujo `pnpm db:migrate` genérico, NO el viejo `db:push`); si `generic` → `Detalle: {error.message}`; botón `Reintentar` (`reset`); `digest` si existe.
- error.tsx por módulo: `"use client"`, default export que renderiza `<RouteError {...props} titulo="No se pudo cargar {Módulo}" modulo="{slug}" />`. Títulos: bi→"Business Intelligence", compras→"Compras", contabilidad→"Contabilidad", crm→"CRM", entregas→"Entregas", gastos→"Gastos", gastos-fijos→"Gastos fijos", inventario→"Inventario", maestros→"Maestros", reportes→"Reportes", tesoreria→"Tesorería", ventas→"Ventas", comex→"Comex".
- `(dashboard)/error.tsx`: fallback genérico (cubre dashboard/admin/perfil).
- `global-error.tsx`: DEBE renderizar su propio `<html lang="es"><body>`; los estilos globales del root layout NO aplican acá → usar estilos inline mínimos (no depender de clases Tailwind), botón Reintentar.

**Tests:** `test/route-error.test.ts` cubre los 4 casos de `classifyRouteError`. Correr `pnpm vitest run test/route-error.test.ts`.

---

### Task 2: Paginar `contabilidad/asientos`

**Files:** Modify `src/app/(dashboard)/contabilidad/asientos/page.tsx`

**Spec:** Query page-local (`db.asiento.findMany`). Agregar `page?/perPage?` al type `SearchParams`; `const { page, perPage } = parsePaginationParams(params)`; reemplazar el `findMany` por `Promise.all([findMany({ where, orderBy, select, take: perPage, skip: (page-1)*perPage }), db.asiento.count({ where })])` → `[asientos, total]`. Header: `{rows.length}` → `{total}` (conteo y plural). Dentro del `<Card className="py-0">`, después de `<AsientosTable data={rows} />`, agregar `<Pagination page={page} perPage={perPage} total={total} className="border-t" />`. Imports: `Pagination`, `parsePaginationParams`.

---

### Task 3: Paginar `tesoreria/movimientos`

**Files:** Modify `src/app/(dashboard)/tesoreria/movimientos/page.tsx`

**Spec:** Query page-local. Agregar `page?/perPage?` al `SearchParams`; `parsePaginationParams`; `Promise.all([db.movimientoTesoreria.findMany({ ..., take: perPage, skip }), db.movimientoTesoreria.count({ where })])`. El bloque `listarPrestamosPorCuentaContable` queda DESPUÉS y opera sobre la página (correcto). Header `{rows.length}`→`{total}`. `<Pagination>` después de `<MovimientosTable>` dentro del Card. Preserva moneda/cuentaId/tipo/fechas solo.

---

### Task 4: Paginar `crm/contactos`

**Files:** Modify `src/app/(dashboard)/crm/contactos/page.tsx`

**Spec:** Hoy NO recibe `searchParams`. Cambiar firma a `({ searchParams }: { searchParams: Promise<{ page?: string; perPage?: string }> })`; `const params = await searchParams; const { page, perPage } = parsePaginationParams(params)`; `Promise.all([db.contacto.findMany({ orderBy, include, take: perPage, skip }), db.contacto.count()])` → `[contactos, total]`. Header `{contactos.length}`→`{total}`; empty-state `contactos.length === 0`→`total === 0`. Agregar `<Pagination page perPage total />` después de `<ContactosTable>` (la página usa `<main>`, no Card — colocarlo debajo de la tabla). Mantener guard `isCrmEnabled()`.

---

### Task 5: Paginar `crm/leads` (action devuelve array → `{rows,total}`)

**Files:** Modify `src/lib/actions/leads.ts` (`listarLeads`) + `src/app/(dashboard)/crm/leads/page.tsx`

**Spec:** `listarLeads(filtros?)`: agregar `page?: number; perPage?: number`; cambiar retorno a `Promise<{ rows: LeadRow[]; total: number }>` con `skip/take` + `count` sobre el MISMO `where`; default perPage 50. Único caller es la page → seguro. Page: agregar `page?/perPage?` al `SearchParams`; `parsePaginationParams`; pasar `page`/`perPage`; destructurar `{ rows, total }`; header usa `total`; empty-state `total === 0`; `<LeadsTableBulk leads={rows} />`; `<Pagination>` después de la tabla. Imports `Pagination`/`parsePaginationParams`.

---

### Task 6: Paginar `gastos` (action devuelve array → `{rows,total,contabilizados,borradores}`)

**Files:** Modify `src/lib/actions/gastos.ts` (`listarGastos`) + `src/app/(dashboard)/gastos/page.tsx`

**Spec:** `listarGastos({ desde, hasta, page?, perPage? })`: devolver `{ rows, total, contabilizados, borradores }` — `contabilizados`/`borradores` son `count`/`groupBy` por estado sobre el set filtrado COMPLETO (patrón `byEstado` de `listarCompras`), no de la página. Único caller es la page. Page: `parsePaginationParams`; destructurar nuevo shape; header usa `total`/`contabilizados`/`borradores` del action (hoy los calcula con `.filter` sobre rows → eliminar eso); `<Pagination>` dentro del `<Card className="py-0">` después de `<GastosTable>`.

---

## Self-Review checklist
- Cada header de lista muestra el **total real**, no el de la página.
- `<Pagination>` preserva los filtros existentes (no se rompe moneda/fecha/estado al paginar).
- `global-error.tsx` NO depende de Tailwind.
- `comex/error.tsx` quedó DRY sobre `<RouteError>` y su mensaje de schema ya no cita `db:push` viejo.
- Maestros NO tocados.
