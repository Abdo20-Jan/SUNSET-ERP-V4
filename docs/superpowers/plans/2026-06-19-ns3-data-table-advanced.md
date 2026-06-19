# NS-3 PR-1 — data-table-advanced + maestros server-side

> **For agentic workers:** Implementación vía Workflow (ultracode) — fundación (1 agente) → 3 maestros (impl→review en paralelo). Gates+commit+PR los consolida el controlador.

**Goal:** Primer sub-PR del bloque NS-3: tabla avanzada reutilizable (sort server-side + toggle de columnas) aplicada a los 3 maestros (productos/clientes/proveedores), migrando búsqueda + filtro secundario al servidor con paginación (cierra lo que NS-1 difirió).

**Architecture:** El sort es **server-driven**: la URL es el estado. Headers clicables (client) empujan `sort`/`dir` a la URL → la page (server) construye `orderBy` dinámico con allowlist. La búsqueda usa debounce→URL (patrón de `asientos-filters.tsx`). El toggle de columnas es estado de sesión del componente (TanStack `columnVisibility`); SavedView (PR-3) lo persistirá. Sin nuqs (se reusa `URLSearchParams`, ya probado en `Pagination`/`MonedaToggle`). Sin schema.

**Tech Stack:** Next.js 16 RSC, @tanstack/react-table v8, Prisma 7.8, vitest node-only (solo helpers puros son unit-testables).

## Global Constraints

- **Sort seguro:** nunca pasar el nombre de columna crudo a Prisma. `buildOrderBy` solo acepta keys del `fieldMap`; la page valida `sort` contra el allowlist vía `parseSortParams`.
- **Contadores del header:** `total` viene de `count`/`groupBy` sobre el set filtrado completo, nunca de `rows.length`.
- **Preservar el CRUD inline** de cada maestro: form dialog (create/edit), delete dialog + su action, botón "Nuevo …", `router.refresh()`. Solo cambia el ORIGEN de los datos (de filtrado-en-cliente a provisto-por-servidor) y se agregan sort headers + columns toggle.
- **Reusar** `<Pagination>` + `parsePaginationParams` (default perPage 50). El search param de búsqueda es `q`; el filtro secundario usa su nombre (`marca`/`estado`/`pais`); sort = `sort`+`dir`.
- `export const dynamic = "force-dynamic"` en las 3 pages (leen searchParams).
- Cambiar de sort/búsqueda/filtro debe resetear `page` (volver a la página 1).

## Referencias (leer antes de codear)
- Búsqueda server con debounce: `src/app/(dashboard)/contabilidad/asientos/asientos-filters.tsx`.
- Tabla maestra actual (CRUD inline + toolbar): `src/app/(dashboard)/maestros/productos/productos-table.tsx`.
- Paginación canónica: `src/app/(dashboard)/compras/page.tsx` + `src/components/ui/pagination.tsx`.

---

### Task 1 (FUNDACIÓN): primitivos reutilizables + helper puro

**Files:**
- Create: `src/lib/table-sort.ts`
- Create: `test/table-sort.test.ts`
- Create: `src/components/ui/sortable-header.tsx`
- Create: `src/components/ui/columns-toggle.tsx`
- Create: `src/components/ui/data-table-search.tsx`

**Spec:**

`src/lib/table-sort.ts` (PURO):
```ts
export type SortDir = "asc" | "desc";
export type SortState = { sort: string; dir: SortDir };

export function parseSortParams(
  params: { sort?: string; dir?: string },
  allowed: readonly string[],
  fallback: SortState,
): SortState {
  const sort = params.sort && allowed.includes(params.sort) ? params.sort : fallback.sort;
  const dir: SortDir = params.dir === "asc" || params.dir === "desc" ? params.dir : fallback.dir;
  return { sort, dir };
}

// fieldMap: sortKey -> nombre de campo Prisma (o ruta). Solo se ordena por keys del map.
export function buildOrderBy(
  state: SortState,
  fieldMap: Record<string, string>,
): Record<string, SortDir> {
  const field = fieldMap[state.sort];
  if (!field) return {}; // sin orden si la key no está permitida (la page ya validó con allowlist)
  return { [field]: state.dir };
}
```

`test/table-sort.test.ts`: cubrir parseSortParams (sort válido/ inválido→fallback; dir válido/inválido→fallback) y buildOrderBy (key permitida→{field:dir}; key no permitida→{}).

`src/components/ui/sortable-header.tsx` ("use client"): `SortableHeader({ columnId, children, align })`. Lee `sort`/`dir` de `useSearchParams`; `active = sort===columnId`; `nextDir = active && dir==="asc" ? "desc" : "asc"`. onClick: `new URLSearchParams(sp)`, `set("sort",columnId)`, `set("dir",nextDir)`, `delete("page")`, `startTransition(()=>router.push(...))`. Renderiza un `<button>` (inline-flex, gap, hover) con `children` + un icono de flecha (Hugeicons `ArrowUp01Icon`/`ArrowDown01Icon`) que solo se muestra si `active` (atenuado si no). `align="right"` justifica a la derecha. aria-label "Ordenar por …".

`src/components/ui/columns-toggle.tsx` ("use client"): `ColumnsToggle<T>({ table }: { table: Table<T> })` (import type `Table` de `@tanstack/react-table`). DropdownMenu con trigger Button outline ("Columnas" + icono) y, por cada `table.getAllColumns().filter(c => c.getCanHide())`, un `DropdownMenuCheckboxItem` (existe en `ui/dropdown-menu`? si no, usar `DropdownMenuItem` con check manual) con `checked={col.getIsVisible()}` y `onCheckedChange={(v)=>col.toggleVisibility(!!v)}`; label = `col.columnDef.meta?.label ?? col.id`. (Para `meta.label` tipado, declarar module augmentation de `@tanstack/react-table` `ColumnMeta` con `label?: string` en este archivo o en un `d.ts`.)

`src/components/ui/data-table-search.tsx` ("use client"): `DataTableSearch({ paramName = "q", placeholder, initialValue })`. Generaliza `asientos-filters`: input controlado con `qDraft` (useState init `initialValue`), debounce 300ms → `updateParam(paramName, value.trim()||null)` (set/delete en URLSearchParams + `delete("page")`) → `startTransition(router.push)`. Icono de búsqueda a la izquierda (patrón de productos-table). Sync con `initialValue` vía useEffect (igual que asientos-filters).

**Tests:** `pnpm vitest run test/table-sort.test.ts`.

---

### Task 2: maestros/productos server-side

**Files:** Modify `src/lib/actions/productos.ts` (`listarProductos`) + `src/app/(dashboard)/maestros/productos/page.tsx` + `src/app/(dashboard)/maestros/productos/productos-table.tsx`

**Spec:**
- **Action:** `listarProductos(opts?: { q?: string; marca?: string; page?: number; perPage?: number; sort?: string; dir?: SortDir })` → `Promise<{ rows: ProductoRow[]; total: number; marcas: string[] }>`. `where`: si `q`, `OR: [{codigo:{contains:q,mode:"insensitive"}},{nombre:{contains:q,mode:"insensitive"}}]`; si `marca` (≠ vacío/"todas"), `marca: marca`. `orderBy = buildOrderBy(parseSortParams({sort,dir}, ALLOWED, {sort:"codigo",dir:"asc"}), FIELD_MAP)` con `FIELD_MAP={codigo:"codigo",nombre:"nombre",marca:"marca",stock:"stockActual",precio:"precioVenta",estado:"activo"}`. clamp page/perPage como listarCompras. `Promise.all([findMany({where,orderBy,select,take,skip}), count({where}), <marcas distinct>])`. `marcas` = `db.producto.findMany({ where:{marca:{not:null}}, distinct:["marca"], select:{marca:true}, orderBy:{marca:"asc"} })` mapeado a `string[]` (sobre TODA la tabla, no filtrado).
- **Page** (server): leer searchParams `{ q?, marca?, page?, perPage?, sort?, dir? }`; `parsePaginationParams`; llamar action; pasar a `<ProductosTable productos={rows} total={total} marcas={marcas} q={q} marca={marca} sort={...} dir={...} page perPage />`. `dynamic="force-dynamic"`.
- **Table:** quitar `searchText`/`marcaFilter`/`marcaOptions`/`filtered` (client). Recibe datos del server. Toolbar: `<DataTableSearch paramName="q" initialValue={q} placeholder="Buscar por código o nombre…"/>` + un Select de marca server-driven (value=`marca||"todas"`, onValueChange→push `marca` a URL+delete page, opciones de `marcas` prop) + `<ColumnsToggle table={table}/>` + botón "Nuevo producto" (preserva formState). Columns: envolver los headers ordenables en `<SortableHeader columnId="codigo|nombre|marca|stock|precio|estado">` (no `medida`/`ncm`/`acciones`); definir `meta:{label}` en cada column para el toggle; `acciones` con `enableHiding:false`. `useReactTable` ahora con `state:{columnVisibility}` + `onColumnVisibilityChange:setColumnVisibility` (useState `{}`). Debajo de la tabla, `<Pagination page perPage total className="border-t"/>`. Conservar ProductoFormDialog + delete dialog + RowActions + `eliminarProductoAction` + `router.refresh()` intactos. Mantener el uso de `<DataTable table=.../>` para el render.

---

### Task 3: maestros/clientes server-side

**Files:** Modify `src/lib/actions/clientes.ts` (`listarClientes`) + `maestros/clientes/page.tsx` + `maestros/clientes/clientes-table.tsx`

**Spec:** Igual que productos, con estas diferencias: búsqueda `OR` por `nombre` + `cuit`; filtro secundario = **estado** (`activo`/`inactivo`/`todos`) → no es distinct (es el boolean `activo`): `estado==="activo"→where.activo=true`, `"inactivo"→false`, `"todos"→sin filtro` (no hay query de opciones, son estáticas). `listarClientes(opts?: { q?; estado?; page?; perPage?; sort?; dir? })` → `{ rows, total }` (sin lista de opciones). FIELD_MAP/ALLOWED sortables: `nombre`,`cuit` (y los que tengan sentido: `condicionIva`?). Default sort `nombre asc`. Columns ordenables: nombre, cuit (y estado si aplica). Preservar el CRUD inline de clientes (form dialog + delete). El Select de estado es server-driven (push `estado`).

---

### Task 4: maestros/proveedores server-side

**Files:** Modify `src/lib/actions/proveedores.ts` (`listarProveedores`) + `maestros/proveedores/page.tsx` + `maestros/proveedores/proveedores-table.tsx`

**Spec:** Igual que productos: búsqueda `OR` por `nombre` + `cuit`; filtro secundario = **pais** (distinct, como marca): `paises` = `db.proveedor.findMany({ distinct:["pais"], select:{pais:true}, orderBy:{pais:"asc"} })`→`string[]` (filtrar nulos/vacíos). `listarProveedores(opts?: { q?; pais?; page?; perPage?; sort?; dir? })` → `{ rows, total, paises }`. Default sort `nombre asc`. Columns ordenables: nombre, cuit, pais. Preservar CRUD inline de proveedores. Select de pais server-driven.

---

## Self-Review checklist
- Sort nunca recibe columna cruda (allowlist + fieldMap).
- Búsqueda/filtro/sort resetean `page`.
- `total` del header = count del set filtrado completo.
- Opciones de marca/pais salen de un distinct sobre la tabla COMPLETA (no de la página).
- CRUD inline de los 3 maestros intacto (create/edit/delete + refresh).
- columnVisibility persiste entre cambios de búsqueda/sort/página (mismo árbol client).
- 3 pages con `force-dynamic`.
