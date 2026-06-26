# IMPLEMENTATION_NOTES_PR018 — COM-02 Venta Record Page (PAGE-STD-02 + FloatingWorkWindow)

**Branch:** `pr-018-venta-record` · **Base:** `main` @ `8af50a62` (PR-017 #344)
**Specs:** `06_RECORD_PATTERN` (PAGE-STD-02), `pages/COM-02_Comercial_Venta`, `08_SALES_MARGIN_RULES`,
`03_GLOBAL_NON_NEGOTIABLE_RULES` (G-04/G-06/G-10), `12_COMPONENT_CATALOG`.

## Objetivo

Llevar el record de Venta (`ventas/[id]`) al patrón canónico PAGE-STD-02 **reusando** el `VentaForm` (grade
Excel + motor de cálculo) y las actions existentes (`guardarVentaAction`/`emitirVentaAction`/
`anularVentaAction`), sin recomputar/reescribir motor ni re-postar asiento/stock. Consume (no reconstruye)
el gate de margen (PR-011) y la pestaña Autorizaciones (PR-013/014).

## Qué cambió

### Cabecera — `AdaptiveRecordHeader` (NUEVO primitivo canónico)
`src/components/record/adaptive-record-header.tsx`. 3 líneas con los **7 campos canónicos** (Código, Status,
Cliente[EntityLink], Fecha, Valor[ARS+USD dual], Responsable, Última actualización) que al rolar se reducen a
una barra sticky de 1 línea vía `IntersectionObserver` sobre un sentinel (sin dependencia nueva). El
`RecordActionBar` se desplaza a `top-11` para no solaparse con la barra compacta.
- **Responsable / Última actualización** no existen en `Venta`: se derivan de `AuditLog`
  (`tabla="Venta"`): evento más antiguo → responsable; más reciente → autor de la última actualización;
  timestamp de `Venta.updatedAt`.

### Pestañas (Resumen-first … Historial-last)
`["resumen", "general"(=Items/Operación), ("entregas" si stock dual), "autorizaciones", "historial"]`,
`resolveActiveTab(..., "resumen")`.
- **Resumen** (NUEVA, `_components/venta-resumen-view.tsx`) — dos columnas: izquierda (Próxima acción +
  cliente + comercial + preview de 5 ítems); derecha (resumen financiero **almacenado** + bloque de margen
  gated). Reusa `RecordSection`/`RecordField` y `EntityLink`.
- **Items / Operación** — `VentaGeneralView` **intacto** (sólo cambia el label de la pestaña).
- **Entregas / Autorizaciones / Historial** — reuso sin cambios (`VentaEntregasView`, `AutorizacionesTab`,
  `AuditTrail`).

### Faixa de Alertas + Próxima acción (sólo datos ya cargados)
`_components/venta-alertas-band.tsx`, sobre las pestañas (06_RECORD_PATTERN). Deriva: venta anulada,
autorización pendiente (`solicitudes.estado==="PENDIENTE"`), cliente bloqueado (`cliente.estado!=="activo"`),
emitida sin asiento. **"costo no cerrado"/"documento pendiente" (CX-07) omitidas** — no derivan de los datos
actuales (CX-07 fuera de alcance). Próxima acción se deriva del `estado` (BORRADOR→editar; EMITIDA→
autorización/entrega; CANCELADA→sin acción).

### Edición en FloatingWorkWindow (G-04)
`_components/venta-edit-window.tsx` (ilha client): botón **Editar** (BORRADOR) → `FloatingWorkWindow`
maximizable que **hospeda el `VentaForm` existente** `embedded`. Espeja `cliente-edit-window.tsx`:
`useDirtyState` + `onRequestClose` + Dialog "Descartar cambios". Se conserva el **footer propio del
VentaForm** (totales + margen live, exigido por COM-02) en vez del `DirtyFooter` genérico. La página pasa de
hacer early-return del form full-page (BORRADOR) a renderizar la shell completa para **todos** los estados.

### Margen en Resumen (decisión del dueño: números completos)
`src/lib/services/margen-venta-resumen.ts` — `obtenerMargenVentaParaResumen(ventaId)` **REUSA** el cálculo
canónico `calcularMargenNetoVenta` (`margen-aprobacion-faixas.ts`) + `sumarCostoItems`; el valor neto se
back-calcula del % (`subtotal × pct / 100`, sin re-derivar la provisión). PR-011 en doble capa: el reader
devuelve `null` sin `costos.ver` (`puedeVerCosto`), y la página gatea el render con `puedeVerMargen()`.

### `VentaForm` (cambios SÓLO aditivos y opcionales)
`_components/venta-form.tsx`: props nuevas `embedded?`, `onCancel?`, `onSuccess?`, `onDirtyChange?`.
`embedded` → footer in-flow (`sticky bottom-0`, sin `fixed`) y sin `pb-32`; Cancelar → `onCancel ??
router.back()`; éxito guardar/emitir → `onSuccess ?? (router.push+refresh)`; `formState.isDirty` se burbujea
por `onDirtyChange`. **Grade de ítems, `useMemo` de totales, rentabilidad por línea, gates PR-011/PR-014 →
intactos.** `/ventas/nueva` no pasa estas props → comportamiento idéntico.

## Lo que NO se tocó
`schema.prisma`/migrations/auth/permisos/motor; grade/cálculo del `VentaForm`; re-posteo de asiento/stock;
las 3 actions de venta (verbatim). Sin masking nuevo (consume PR-011), sin flujo de aprobaciones (consume
PR-013/014). Sin tocar worklist PR-017, modelo/pestaña Documentos (CX-07), record de Pedido (COM-03), ni
otros módulos. La anulación reusa el Dialog de confirmación existente (sin campo "motivo" — exigiría tocar
`anularVentaAction`).

## Archivos
**Nuevos:** `components/record/adaptive-record-header.tsx`,
`ventas/[id]/_components/{venta-resumen-view,venta-alertas-band,venta-edit-window}.tsx`,
`lib/services/margen-venta-resumen.ts`, este doc.
**Modificados:** `ventas/[id]/page.tsx`, `ventas/_components/venta-form.tsx`.

## Verificación
`pnpm prisma generate && pnpm typecheck && pnpm build && pnpm biome:ci && pnpm test`. Los tests de
venta (`ventas-costo-masking`, `venta-flete-gasto`, `venta-split-categoria`, `venta-costo-cero-guard`,
`entrega-valida-venta-emitida`) prueban actions/motor — no se tocan → deben quedar verdes. QA visual con
Postgres descartable (ver memoria `reference_qa_local_env_override`; nunca `pnpm dev` crudo → habla con PROD).
