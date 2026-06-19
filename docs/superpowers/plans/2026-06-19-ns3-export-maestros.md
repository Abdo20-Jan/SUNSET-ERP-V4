# NS-3 PR-2 — Export CSV/XLSX (maestros)

> **For agentic workers:** Workflow (ultracode) — Fase 1 (funciones de export por entidad) → Fase 2 (infra + wiring). Gates+commit+PR los consolida el controlador. `exceljs` YA instalado (package.json + lockfile).

**Goal:** Segundo sub-PR de NS-3: export CSV + XLSX de la **vista filtrada** (todas las filas que matchean búsqueda/filtro/sort actuales, SIN paginación) de los 3 maestros, vía una infraestructura reutilizable basada en registry.

**Architecture:** Route handler `GET /api/export/[recurso]?{filtros}&formato=csv|xlsx` (sigue el precedente `src/app/api/retenciones/[id]/certificado/route.ts`: `auth()` guard + `NextResponse` con `Content-Disposition`). Un `EXPORT_REGISTRY` mapea `recurso → { filename, sheetName, columns, fetchRows }`. `fetchRows(searchParams)` reusa la lógica de filtros/sort de la action (vía `listarXxxParaExport`) y trae TODAS las filas. El `<ExportButton>` (client) preserva los searchParams actuales. CSV puro testeable; XLSX vía exceljs.

**Tech Stack:** Next.js 16 route handlers, exceljs 4.4, Prisma 7.8, vitest node-only.

## Global Constraints

- El export respeta los MISMOS filtros/sort que la tabla (lee searchParams: q, marca/estado/pais, sort, dir) pero IGNORA page/perPage (trae todo el set filtrado).
- Reusar el sort allowlist/fieldMap de cada action (NO duplicar) — exportar esas constantes desde el action.
- Sort seguro: el export pasa por `parseSortParams`/`buildOrderBy` igual que la lista (nunca columna cruda a Prisma).
- `auth()` guard en la route (401 si no hay sesión); `recurso` desconocido → 404; `formato` inválido → default csv.
- CSV: UTF-8 con **BOM** (`﻿`) para que Excel abra acentos OK; escaping RFC4180 (comillas, comas, saltos de línea).
- No tocar la lógica de paginación/CRUD de PR-1.

## Referencia
- Download precedente: `src/app/api/retenciones/[id]/certificado/route.ts`.
- Actions ya refactorizadas (PR-1): `src/lib/actions/{productos,clientes,proveedores}.ts` (tienen el where/orderBy con allowlist; productos/proveedores con distinct de opciones).

---

### Fase 1 (Tarea A): funciones de export por entidad

**Files:** Modify `src/lib/actions/productos.ts`, `src/lib/actions/clientes.ts`, `src/lib/actions/proveedores.ts`

**Spec (las 3 actions, mismo patrón):**
- Exportar (hacer `export`) las constantes de sort que hoy son privadas: `PRODUCTOS_SORT_ALLOWED`/`PRODUCTOS_SORT_FIELD_MAP` (y el default), idem clientes/proveedores. Si no existen como constantes nombradas, extraerlas.
- Agregar `listarProductosParaExport(opts: { q?: string; marca?: string; sort?: string; dir?: SortDir }): Promise<ProductoRow[]>` que construye el MISMO `where` (q→OR contains insensitive sobre codigo/nombre; marca≠""/"todas"→marca) y `orderBy = buildOrderBy(parseSortParams({sort,dir}, ALLOWED, default), FIELD_MAP)`, y hace `db.producto.findMany({ where, orderBy, select })` SIN take/skip (todas las filas). Mismo `select`/map a `ProductoRow` que `listarProductos`. Para DRY, extraer un helper privado `buildProductosWhere(opts)` usado por `listarProductos` y `listarProductosParaExport`.
- Clientes: `listarClientesParaExport(opts: { q?; estado?; sort?; dir? }): Promise<ClienteRow[]>` (where: q→OR nombre/cuit; estado "activo"/"inactivo"→where.estado; "todos"/""→sin filtro). Recordar: `Cliente.estado` es String.
- Proveedores: `listarProveedoresParaExport(opts: { q?; pais?; sort?; dir? }): Promise<ProveedorRow[]>` (where: q→OR nombre/cuit; pais≠""/"todos"→pais).
- No cambiar las firmas de `listarXxx` existentes ni el CRUD.

---

### Fase 2 (Tarea B): infraestructura de export + wiring

**Files:**
- Create: `src/lib/export/types.ts`, `src/lib/export/csv.ts`, `test/export-csv.test.ts`, `src/lib/export/xlsx.ts`, `src/lib/export/registry.ts`
- Create: `src/app/api/export/[recurso]/route.ts`, `src/components/ui/export-button.tsx`
- Modify: `src/app/(dashboard)/maestros/{productos,clientes,proveedores}/*-table.tsx` (agregar `<ExportButton>` al toolbar)

**Spec:**

`src/lib/export/types.ts`:
```ts
export type ExportColumn<T> = { header: string; value: (row: T) => string | number | null };
```

`src/lib/export/csv.ts` (PURO):
```ts
import type { ExportColumn } from "./types";
function esc(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(c.value(r))).join(",")).join("\r\n");
  return `﻿${head}${rows.length ? `\r\n${body}` : ""}`; // BOM para Excel
}
```
`test/export-csv.test.ts`: headers; valor con coma/comilla/salto de línea escapado; null→""; BOM presente; sin filas → solo header.

`src/lib/export/xlsx.ts`:
```ts
import ExcelJS from "exceljs";
import type { ExportColumn } from "./types";
export async function toXlsx<T>(columns: ExportColumn<T>[], rows: T[], sheetName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(columns.map((c) => c.header));
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(columns.map((c) => c.value(r) ?? ""));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
```

`src/lib/export/registry.ts`: `export type ExportResource = { filename: string; sheetName: string; columns: ExportColumn<any>[]; fetchRows: (sp: URLSearchParams) => Promise<any[]> }`. `export const EXPORT_REGISTRY: Record<string, ExportResource>` con `productos`/`clientes`/`proveedores`. Cada `fetchRows(sp)` parsea `q`, el filtro (`marca`/`estado`/`pais`), `sort`, `dir` desde `sp`, y llama `listarXxxParaExport({...})` (usando el allowlist exportado del action para validar sort). `columns` = specs flat (headers en español): productos → Código, Nombre, Marca, Medida, NCM, Stock, Precio venta, Estado (activo/inactivo); clientes → Nombre, CUIT, Condición IVA, Teléfono, Email, Estado, Cuenta; proveedores → Nombre, CUIT, País, Tipo, Estado, Cuenta. (Elegir campos reales del Row type; valores numéricos como number cuando aplique.)

`src/app/api/export/[recurso]/route.ts`:
```ts
export const dynamic = "force-dynamic";
// GET → auth guard; recurso ∈ registry (404); formato csv|xlsx; fetchRows(sp); build + Content-Disposition.
```
- auth: `const session = await auth(); if (!session) return new NextResponse("No autorizado.", { status: 401 });`
- `const res = EXPORT_REGISTRY[recurso]; if (!res) return new NextResponse("Recurso no encontrado.", { status: 404 });`
- `const sp = new URL(req.url).searchParams; const formato = sp.get("formato") === "xlsx" ? "xlsx" : "csv";`
- `const rows = await res.fetchRows(sp);`
- CSV: `Content-Type: text/csv; charset=utf-8`; filename `${res.filename}.csv`. XLSX: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; filename `${res.filename}.xlsx`. Ambos `Content-Disposition: attachment; filename="..."`, `Cache-Control: no-store`.

`src/components/ui/export-button.tsx` ("use client"): `ExportButton({ recurso }: { recurso: string })`. DropdownMenu (trigger Button outline + icono Download + "Exportar"); items = `<a href={href("csv")} download>CSV</a>` y `<a href={href("xlsx")} download>Excel (XLSX)</a>` (usar `DropdownMenuItem render={<a .../>}` siguiendo el patrón del repo). `href(formato)`: `const q = new URLSearchParams(searchParams.toString()); q.set("formato", formato); q.delete("page"); q.delete("perPage"); return \`/api/export/${recurso}?${q}\`;` (preserva q/filtro/sort, descarta paginación). Icono Hugeicons `Download01Icon` o `Download04Icon` (verificar cuál existe).

**Wiring:** en cada `*-table.tsx`, agregar `<ExportButton recurso="productos|clientes|proveedores" />` en el toolbar, junto a `<ColumnsToggle>`. No tocar nada más de la tabla.

---

## Self-Review checklist
- `toCsv` con BOM + escaping correcto (testeado).
- El export trae TODAS las filas filtradas (sin take/skip), respetando q/filtro/sort.
- Sort del export pasa por allowlist (reusa la constante del action).
- Route con auth guard; 404 para recurso desconocido.
- `<ExportButton>` preserva searchParams actuales y descarta page/perPage.
- exceljs importado solo en el server (xlsx.ts / route), nunca en client.
