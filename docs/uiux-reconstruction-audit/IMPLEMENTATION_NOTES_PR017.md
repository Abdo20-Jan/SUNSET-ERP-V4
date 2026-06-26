# IMPLEMENTATION NOTES — PR-017 (COM-01 · Comercial Worklist de Documentos)

> Abre la **Wave 2** (adopción del patrón worklist por módulo). Migración **UI-only**:
> entrega la worklist canónica **Comercial > Documentos** sobre el `EnterpriseDataGrid`
> ya existente (referencia: piloto Productos / PR-003), unificando los tipos que EXISTEN
> hoy — **Venta + Pedido de venta** — reusando los services de lectura actuales y
> preservando rutas/acciones. **Sin cambios de backend / schema / motores.**

## Decisiones del dueño aplicadas
- **Export: DIFERIDO** (placeholder deshabilitado "Exportar selección · PR-005"). El export
  funcional/auditado es responsabilidad de PR-005; aquí no se toca `export/registry.ts` ni el
  modelo de permisos.
- **Ruta:** `/ventas/documentos` (alineada a la estructura actual `/ventas/*`; nav mínima).
- **Branch:** `pr-017-comercial-worklist` creado desde `origin/main` limpio.

## Qué se entregó
- Worklist unificada (Pedidos + Ventas) en `EnterpriseDataGrid` con:
  - **4 columnas congeladas (OD-01):** Número · Tipo · Cliente · Status (`meta.pinned:"left"`).
  - Columnas adicionales (scroll horizontal): Fecha · Venc./Prevista · Moneda · **Valor**
    (presentación ARS/USD vía `fmtMontoPres`) · Ítems (pedidos).
  - **Quick search** (número / cliente), **FilterBar** (Tipo · Status · Cliente · Moneda),
    **SavedViews** (Todos · Pendientes · Borradores · Cancelados),
    **EntityLink + chevron** (Número → record; Cliente → ficha),
    **selección** con resumen sticky **Suma ARS / Suma USD**.
- **Read aggregator de SÓLO lectura** que reusa `listarVentas` + `listarPedidosVenta`
  (no los modifica) y los une con una función pura testeable.
- **Rutas/acciones existentes intactas** (`/ventas`, `/ventas/pedidos`, records, forms,
  `guardar/emitir/anular` venta, `guardar/transicionar/crearVentaDesdePedido`): la worklist
  **navega** a los records; no reimplementa lógica de negocio.

## Archivos
**Nuevos**
- `src/lib/comercial/documentos.ts` — tipo `ComercialDocRow` + funciones puras
  `ventaToDoc` / `pedidoToDoc` / `mergeComercialDocumentos` + predicados de vistas
  (`esBorrador` / `esCancelado` / `esPendiente`). Sin DB ni JSX → testeable.
- `src/lib/actions/comercial-documentos.ts` — `"use server"` aggregator
  `listarComercialDocumentos({incluirCanceladas})` (itera páginas de `listarVentas` para no
  truncar en el tope de 500/página; aplica `incluirCanceladas` a ambos tipos).
- `src/app/(dashboard)/ventas/documentos/page.tsx` — server page (moneda/tc + MonedaToggle).
- `src/app/(dashboard)/ventas/documentos/_components/comercial-documentos-columns.tsx`
  — `buildComercialColumns({moneda,tc})` data-driven.
- `src/app/(dashboard)/ventas/documentos/_components/comercial-documentos-table.tsx`
  — montaje del grid (client).
- `test/comercial-documentos.test.ts` — unit test de las funciones puras de merge/map/predicados.

**Modificados**
- `src/components/layout/nav-model.ts` — entrada **Documentos** (`/ventas/documentos`, `status:"active"`,
  `pageCode:"COM-01"`) en el módulo Comercial. Es la **fuente canónica del AppShell default** (cutover
  PR-015): alimenta top-nav (`ModuleMegaMenu`), GlobalSearch (`flattenNavTargets`) y el mobile drawer
  (`ShellNavDrawer`) vía `useVisibleModules()`. Sin `permission` ⇒ siempre visible.
- `src/components/layout/nav-config.ts` — entrada **Documentos** en Comercial > Ventas (aditiva). Es la
  fuente del **shell legado** (`TOP_NAV_ENABLED=false`). Se mantiene para paridad: ambos shells muestran
  "Documentos" sin romper la navegación legada.

## Columnas sensibles (costo/margen)
**Omitidas por ausencia de dato**, no por falta de gate. `listarVentas` / `listarPedidosVenta`
no exponen costo ni margen (sólo totales). PR-007 (`PermissionGate`) y PR-011
(`puedeVerCosto/Margen`) están en `main` pero no aplican a esta lista. Coherente con la spec
COM-01: la margen se trata sólo como información sensible auditable; el detalle por línea vive
en las fichas COM-02/03 (PR-018/019). Regla mantenida: **nada sensible se expone sin gate.**

## Limitaciones honestas (documentadas)
- **Export** deshabilitado → PR-005 (auditado + permiso `export_excel`).
- **Columnas no disponibles** (Vendedor, Depósito, Status financiero del cliente, Entrega,
  Factura, Próxima acción): los services actuales no las devuelven y el PR no toca backend.
  Se omiten en lugar de mostrarlas vacías. La spec las lista como "as available".
- **Filtros de rango** (Fecha) y **Vendedor**: el `FilterBar` sólo soporta chips de igualdad +
  el dato no existe → fuera de este PR.
- **SavedViews [Aprobación] / [Bloqueados]:** dependen de estado de aprobación / situación
  financiera del cliente que los services no exponen → diferidas (no se muestra una vista
  siempre-vacía). Se entrega **[Pendientes]** (derivable del estado) + Borradores + Cancelados.
- **Presupuesto** diferido (PR-033/COM-04): la worklist tolera su futura incorporación
  (sólo agregar un `*ToDoc` + caso en el aggregator) pero hoy no se muestra.

## Patrón de referencia (para los demás PRs de Wave 2)
1. Función pura `*ToDoc` + `merge*` + predicados en `src/lib/<modulo>/…` (testeable sin DB).
2. `"use server"` aggregator que reusa services existentes (no los modifica).
3. `build*Columns({...ctx})` data-driven con `meta.pinned:"left"` para freeze (complejidad ≤8).
4. Client table que cablea `EnterpriseDataGrid` (quickSearch/filters/savedViews/selección).
5. Server page con `MonedaToggle` + `tc`. Entrada de nav aditiva.

## Validación
`pnpm prisma generate` · `pnpm typecheck` · `pnpm build` · `pnpm biome:ci` · `pnpm test`.
Sin commit/push (queda para revisión del dueño).
