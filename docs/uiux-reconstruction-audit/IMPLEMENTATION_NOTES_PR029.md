# IMPLEMENTATION_NOTES_PR029 — COMP-01 Compras: worklists OC/facturas + Record de la OC + aba Recepción (OD-11) + vínculo Comex

**Branch:** `pr-029-compras-oc-record` · **Base:** `main` @ `9c578e0e` (limpia, sin stacking; series 025–028 ya mergeadas)
**Specs:** `05_WORKLIST_PATTERN` (PAGE-STD-01), `06_RECORD_PATTERN` (PAGE-STD-02, G-04), `pages/COMP-01_Compras_Ordenes_Compra`,
`pages/COMP-02_Compras_Recepcion` (**OD-11**), `03_GLOBAL_NON_NEGOTIABLE_RULES`, `07_PERMISSIONS_AUDIT_SECURITY`,
`09_COMEX_RATEIO_DO_NOT_TOUCH` (adyacencia).

## Objetivo

Llevar el módulo Compras (último gran módulo 100% pre-patrón) al canon: worklists EnterpriseDataGrid para
`/compras/pedidos` (OC) y `/compras` (facturas), el record de la OC (`pedidos/[id]`) en PAGE-STD-02 **espejando el
PR-019** (Pedido de Venta), pestaña Comex (vínculo `Embarque.pedidoCompraId`) con entry point "Generar proceso
Comex", y **OD-11: Recepción como PESTAÑA read-only derivada** (nunca ruta). UI-only: DISPLAY + HOST/CALL de las
actions existentes con payload byte-idéntico; engines de stock/asiento y circuito Comex con **cero toque**; sin
schema; sin permiso nuevo.

## 🚩 Preflight-5 — "Generar proceso Comex": CASO (b), prefill DIFERIDO

- `Embarque.pedidoCompraId` (schema:971) es **write-orphan**: ningún código lo escribe (verificado en
  `embarques.ts` create/update, `asiento-automatico.ts`, seed, scripts). Único lector:
  `cuentas-a-pagar.ts:1906-1959` (mapa `embarquePorPedido`, lógica HOY dormida).
- `comex/embarques/nuevo/page.tsx` no acepta `searchParams`; el `EmbarqueForm` no tiene campo pedido; el
  `embarqueInputSchema` (zod) no tiene `pedidoCompraId` (y no es `.passthrough()`).
- El prefill exigiría tocar 4 puntos del circuito Comex protegido **y NO es inerte**: poblar el campo activa la
  bucketización dormida de Compras USD bajo embarque en `getSaldosExteriorPorProveedor` (los 3 paths del #164),
  cambiando comportamiento observable de CxP exterior sin golden que lo cubra.
- **Decisión:** botón = **LINK simple** a `/comex/embarques/nuevo`; la pestaña Comex lista embarques ya vinculados
  con empty-state honesto ("el vínculo automático llega en un PR futuro"). Follow-up propio: escribir
  `pedidoCompraId` en el create del embarque + golden del path de CxP exterior.

## 🚩 Flags de honestidad (espejo PR-019)

- **Auditoría inexistente:** `pedidos-compra.ts`/`compras.ts` no llaman `registrarAuditoria` (cero ocurrencias) →
  pestaña **Historial** muestra "Sin historial" (AuditTrail vacío), `responsable = "—"` (no hay userId en el
  model), última actualización = `updatedAt` sin "por Usuario". NO se instrumentaron las actions.
- **`CompraEstado.RECIBIDA` es enum-muerto:** ninguna action lo escribe (solo filtros de lectura). Por eso la
  trilha comercial usa el filtro canónico `estado IN (EMITIDA, RECIBIDA)` (mismo de `cuentas-a-pagar.ts:556`,
  `bi.ts:1200`) y la física deriva de `MovimientoStock`/`ItemDespacho`, no del enum.
- **Máquina de estados del pedido:** `transicionarPedidoCompraAction` no valida transiciones (comportamiento
  actual, hospedado verbatim con las MISMAS condiciones de visibilidad del detalle bespoke anterior).

## Columnas COMP-01 (canon 11) — consume-or-omit

| Canon | Veredicto | Nota |
|---|---|---|
| OC | ✅ | `numero`, EntityLink, congelada |
| Fornecedor | ✅ | EntityLink → maestros, congelada |
| Tipo (Nacional/Importación) | ❌ OMITIDA | sin campo en el model; derivar por embarques daría constante (nunca escritos) |
| Status | ⚠️ PARCIAL | 6 estados reales (`PedidoEstado`), no los 7 de la ficha (sin "Aprobada"/"Facturada"); StatusBadge compartido intacto (ENVIADO/CONFIRMADO caen `neutral`) |
| Data | ✅ | + Prevista (accessorFn + sortUndefined:"last") |
| Moeda | ✅ | |
| Valor | ✅ | "Total est." native-first `fmtMontoPres` (sin IVA, como la UI actual) |
| Responsável | ❌ OMITIDA | sin userId + AuditLog vacío |
| Aprovação | ❌ OMITIDA | PR-012 INERTE, cero `Solicitud` para PedidoCompra |
| Saldo recebido | ❌ en worklist | vive en el record (aba Recepción); inviable/ambiguo como columna de grid |
| Saldo faturado | ⚠️ DEGRADADA | columna "Compras" = count de vinculadas EMITIDA/RECIBIDA (groupBy barato); el % fino vive en el record |

Sub-vistas `?vista=` (presets de URL server-side, lección PR-010 — NO SavedViews in-memory): todas / abiertas /
completadas / canceladas. Worklist de `/compras`: paginación server **preservada** (`page`/`perPage`), KPIs ×4
preservados, quickSearch/chip Estado operan sobre la página cargada (placeholder honesto "Buscar en esta
página…"), columna nueva "Pedido (OC)" (EntityLink, cierra el ciclo OC↔factura), grid `pageSize=max(100, rows)`
para no paginar por encima de la server.

## Record de la OC — mapa de pestañas (PAGE-STD-02)

`RecordLayout` + `AdaptiveRecordHeader` (7 campos: Código `Pedido OC-…` · StatusBadge · Proveedor EntityLink ·
Valor dual ARS+USD inline — `DualCurrencyAmount` NO existe como componente; se renderiza con 2 `<span>` +
`fmtMontoPres`, patrón PR-018/019 · Responsable "—" · meta Fecha/Prevista/Moneda·TC/Última actualización) +
`RecordActionBar` + faixa de alertas (`VentaAlertasBand` reusada cross-record, presentacional — igual que PR-019
la reusó del PR-018) + `RecordTabs` URL-driven:

| Tab | Contenido | Fuente (READ) |
|---|---|---|
| Resumen | 2 columnas: próxima acción, proveedor, datos, preview 5 ítems, **Facturación** (badge "Facturado X%", chips de facturas — espejo del bloque Conversión PR-019) · derecha: total estimado + vínculo Comex | `obtenerPedidoCompraPorId` + derivaciones |
| Items / Operación | # · Producto · Cant. pedida · facturada (cap por línea) · pendiente · Precio · Total neto · Estado línea | `derivarLineasPedidoCompra` (espejo `derivarLineasPedido`) |
| Compras vinculadas | tabla densa numero/fecha/estado/total native-first | `db.compra.findMany({ pedidoCompraId })` |
| Comex | embarques vinculados (codigo EntityLink, estado, salida/llegada, FOB — **sin landed**: canon A.2 da `Ver costo landed = ❌` a Compras) + botón link | `db.embarque.findMany({ pedidoCompraId })` select estrecho |
| Recepción | ver abajo | `obtenerRecepcionPedidoCompra` |
| Historial | AuditTrail (vacío, flag arriba) | `getAuditLog("PedidoCompra", id)` |

Edición: `pedido-compra-edit-window.tsx` (FWW 1100×760 `defaultMaximized`, `useDirtyState` + Dialog "Descartar
cambios") hospeda el `PedidoCompraForm` `embedded`; se **eliminó** el branch full-page `?editar=1` y
`pedido-compra-detail.tsx` (espejo exacto de la eliminación del PR-019). Acciones:
`pedido-compra-detail-actions.tsx` hospeda `transicionarPedidoCompraAction` verbatim (Marcar enviado / Confirmar /
Marcar completado / Cancelar con Dialog — mismas condiciones del bespoke: BORRADOR→enviado; ENVIADO|PARCIAL→
confirmar; no-terminal→completado/cancelar) y `crearCompraDesdePedidoAction` verbatim (éxito →
`router.push(/compras/{id})`, como hoy).

## Recepción (OD-11) — derivación documentada

`src/lib/services/pedido-compra-recepcion.ts` — READ-ONLY, puro+queries, **dos trilhas separadas que NUNCA se
suman** (comercial ≠ física):

| Métrica | Fórmula | Fuente |
|---|---|---|
| Pedida | Σ `ItemPedidoCompra.cantidad` por producto | OC |
| Facturada (comercial) | Σ `ItemCompra.cantidad` de compras vinculadas `estado IN (EMITIDA, RECIBIDA)`, cap por producto a lo pedido (conversión no idempotente); bruta visible cuando excede | `Compra.pedidoCompraId` |
| Ingresada a stock (física nacional) | Σ `MovimientoStock` `tipo=INGRESO` con `itemCompraId` de esas compras — la anulación **borra** los movimientos (`revertirIngresoCompra`), la suma es el neto real; líneas servicio/gasto no generan movimiento (correcto que no cuenten) | E18 |
| Embarcada (informativa) | Σ `ItemEmbarque.cantidad` de embarques vinculados ≠ BORRADOR | `Embarque.pedidoCompraId` |
| Nacionalizada (física comex) | Σ `ItemDespacho.cantidad` de despachos `CONTABILIZADO` (mapeo vía `itemEmbarqueId`→producto) + fallback legacy anti-doble-conteo: embarque con `asientoId` y **cero** despachos ⇒ todo `ItemEmbarque.cantidad` | despachos |
| Pendiente de facturar | max(0, pedida − facturada) — SOLO trilha comercial | derivada |

Junción por `productoId` (no hay FK ítem-a-ítem): líneas duplicadas colapsan; documentos sin vínculo no se
incluyen; productos fuera de pedido aparecen con `pedida=0` y rótulo "Fuera de pedido". Disclaimers renderizados
EN la pestaña. Sin botones de transición ni estados inventados (`PedidoEstado.PARCIAL/COMPLETADO` es manual → no
se usa como fuente).

## Evidencia payload-idéntico / props aditivas

- `PedidoCompraForm`: SOLO 4 props opcionales `embedded?/onCancel?/onSuccess?/onDirtyChange?` — diff EXACTO del
  PR-019 (`pedido-venta-form.tsx:74-88`): footer `embedded ? sticky : fixed` (sin `pb-32`), `onCancel ??
  router.back()`, `onSuccess ?? (push+refresh)`, `useEffect` burbujea `isDirty`. **Grade, cálculo, zod, payload de
  `guardarPedidoCompraAction`: intactos** (el submit no cambió ni un byte). `/compras/pedidos/nuevo` no pasa
  ninguna prop nueva → comportamiento idéntico.
- `transicionarPedidoCompraAction(id, nuevoEstado)` y `crearCompraDesdePedidoAction(pedidoId)`: llamadas con los
  MISMOS argumentos y manejo de resultado que el detalle bespoke eliminado.
- **Cero ediciones en `pedidos-compra.ts`/`compras.ts`** — incluso `updatedAt` del header y el vínculo OC de la
  worklist de facturas salen por **queries paralelas page-level** (más estricto que el PR-019, que editó el DTO).
- Circuito Comex (`embarques.ts`, `embarque-schema.ts`, `embarque-form.tsx`, `nuevo/page.tsx`): **0 bytes de diff**.

## Permisos / auditoría

Sin clave nueva; sin gate de página (compras es abierta hoy; se mantiene "acceso como hoy"). El masking existente
`costos.ver` sobre `costoPromedio` de los combos vive en las actions y sigue intacto. Export ×2 auditado
(patrón fin-cxc): action `"use server"` → `requireSessionUser()` → re-read server-side con los MISMOS presets
puros (nunca serializa el client) → `toCsv`/`toXlsx` → `auditarExportacion({ recurso: "compras-pedidos" |
"compras", filtros, columnas, nFilas, formato })` **antes** de entregar (evento EXPORTACIÓN en /sistema/auditoria).
La clave canónica `export_excel` no existe en el catálogo — documentado, no inventado. Pestaña Comex sin
`costoTotal`/`cifTotal` (FOB abierto, patrón CX-02).

## Archivos

**Nuevos:**
`compras/pedidos/[id]/_components/{pedido-compra-edit-window,pedido-compra-detail-actions,pedido-compra-resumen-view,pedido-compra-items-view,pedido-compra-compras-tab,pedido-compra-comex-tab,pedido-compra-recepcion-tab}.tsx`,
`compras/pedidos/_components/{pedidos-compra-presentacion.ts,pedidos-compra-columns.tsx,pedidos-compra-worklist.tsx,pedidos-compra-export-button.tsx}`,
`compras/_components/{compras-presentacion.ts,compras-columns.tsx,compras-worklist.tsx,compras-export-button.tsx}`,
`lib/services/pedido-compra-recepcion.ts`, `lib/actions/{compras-pedidos-export,compras-export}.ts`,
`test/{pedido-compra-recepcion,pedido-compra-items-derivacion,pedidos-compra-presentacion}.test.ts`, este doc.
**Modificados:** `compras/pedidos/page.tsx` (worklist + presets `?vista=`), `compras/page.tsx` (worklist;
paginación/KPIs preservados), `compras/pedidos/[id]/page.tsx` (reescrita a RecordLayout),
`pedido-compra-form.tsx` (4 props aditivas), `compra-detail-view.tsx` (link reverso "Pedido (OC)" + extracción
`DatosCard` por CCN), `compras/[id]/page.tsx` (query del número de OC), `nav-model.ts` (1 ítem: `pageCode:
COMP-01` movido al ítem de `/compras/pedidos` — estaba en el de facturas).
**Eliminados:** `pedido-compra-detail.tsx`, `pedidos-compra-table.tsx`, `compras-table.tsx` (sin importadores,
verificado por grep).

## Lizard / Codacy

`uvx lizard -C 8 -l typescript` sobre todos los archivos del PR: **0 funciones nuevas > 8**.
`derivarRecepcionPorProducto` refactorizada (13→≤8, helpers `cantidadDe`/`capFacturada`); `CompraDetailView`
bajó extrayendo `DatosCard`. Excepción documentada: `PedidoCompraForm` CCN 9 — **paridad exacta** con
`PedidoVentaForm` (CCN 9 en main, gate Codacy aprobado en el PR-019); mismo shape de diff.

## Verificación (todo ejecutado — resultados)

`pnpm prisma generate` ✓ · `pnpm typecheck` ✓ · `pnpm build` ✓ (2 corridas, incl. post-refactors) ·
`pnpm biome:ci` ✓ (0 errores; 48 warnings pre-existentes) · **`pnpm test` 177/177 archivos, 1351/1351 tests ✓**
(la 1ª corrida falló por Docker daemon apagado — infra, 0 tests reales rotos; verde con Docker arriba) ·
`uvx lizard -C 8 -l typescript` sobre los archivos del PR: 0 funciones > 8 (ver sección Lizard) ·
**`pnpm db:validar-stock` ✓ + `pnpm db:validar-asientos` ✓** contra el DB de QA CON la compra emitida vía la UI
nueva (asiento Nº 1 + MovimientoStock reales). Tests nuevos: 19 (recepción 10 · items-derivación 5 ·
presentación 4).

## QA visual EJECUTADO (Postgres descartable puerto 55432 + env override; dev server :3029; Playwright)

Fixture: seed completo (631 cuentas, depósito NACIONAL) + proveedor/2 productos/cotización 1200/período 2026 vía
SQL (gotcha: los UUID de fixture deben ser RFC-válidos — variant 8/9/a/b — o el zod `.uuid()` los rechaza).

- [x] Worklist OC: 9 columnas (3 congeladas), vistas `?vista=` como links, quickSearch, empty-state honesto;
      **export CSV descarga y graba EXPORTACION** (`recurso: compras-pedidos`, columnas/nFilas/filtros en
      `datosNuevos` — verificado en AuditLog); archivo native-first (Total 600 + columna Moneda USD).
- [x] Record OC completo: header 7 campos (dual 720.000,00 ARS / 600,00 USD con TC 1200 ✓), 6 pestañas con
      counts; **Editar → FWW maximizada con el MISMO form embedded** (footer sticky in-flow); cambio de cantidad
      10→12 + intento de cierre → **Dialog "Descartar cambios"** ✓; Guardar → persiste, ventana cierra, record
      refresca ✓.
- [x] Transiciones verbatim: BORRADOR→ENVIADO (aparece "Confirmar" ✓); **"Crear factura desde pedido"** creó
      C-2026-0001 BORRADOR idéntica (ítems copiados, IVA 21%, notas "Creada desde pedido OC-2026-0001") y navegó
      a `/compras/{id}` como siempre.
- [x] Emitir vía UI (categoría 1.1.7.01 + depósito NACIONAL): **asiento Nº 1 + ingreso de stock generados por el
      engine intocado**; el motor exigió período contable abierto (validación real intacta). La ficha de Compra
      muestra el campo nuevo **"Pedido (OC)" → EntityLink OC-2026-0001**.
- [x] Recepción (OD-11): Pedida 12 · Facturada 12 · Pendiente 0 (comercial) · **Ingresada a stock 12** (física) ·
      trilhas separadas + 3 disclaimers renderizados; embarque QA vinculado (SQL `pedidoCompraId=1`) con producto
      9002 fuera de la OC → línea **"Fuera de pedido"** con Embarcada 8 ✓.
- [x] Comex: embarque vinculado listado (EntityLink → ficha, estado, salida, FOB 600 USD — sin landed); botón
      "Generar proceso Comex" = link a `/comex/embarques/nuevo`; empty-state honesto antes del vínculo.
- [x] Worklist Compras: columna **"Pedido (OC)"** con EntityLink; Vencimiento relativo sólo EMITIDA; KPIs y
      paginación server preservados.
- [x] `nuevo/` renderiza el camino legado (footer `fixed`, sin props nuevas); Historial count 0 (honesto).
- [x] Invariantes stock+ledger verdes DESPUÉS de operar todo por la UI nueva.

## Rollback

Revert del PR: las pages vuelven a tabla+detalle (los 3 archivos eliminados vuelven con el revert); cero
migraciones, cero cambios de actions/engines/permisos.
