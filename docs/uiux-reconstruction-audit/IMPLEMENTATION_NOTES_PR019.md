# IMPLEMENTATION_NOTES_PR019 — COM-03 Pedido de Venta Record Page (PAGE-STD-02 + FloatingWorkWindow)

**Branch:** `pr-019-pedido-record` · **Base:** `pr-018-venta-record` @ `319b4d7e` (stack sobre PR-018 abierto)
**Specs:** `06_RECORD_PATTERN` (PAGE-STD-02), `pages/COM-03_Comercial_Pedido` (OD-02), `08_SALES_MARGIN_RULES`,
`03_GLOBAL_NON_NEGOTIABLE_RULES` (G-04/G-06/G-10).

## Objetivo

Llevar el record de Pedido (`ventas/pedidos/[id]`) al patrón canónico PAGE-STD-02 **espejando el PR-018
(Venta Record)**: `RecordLayout` + `AdaptiveRecordHeader` (7 campos) + Resumen-first + faixa de Alertas +
Próxima acción + edición/acciones en `FloatingWorkWindow`, **reusando** el `PedidoVentaForm` y las actions
existentes. Sólo **DISPLAY** + **CALL** de actions actuales; sin recompute, sin schema, sin motor. Consume
(no reconstruye) el gate de margen (PR-011) y la pestaña Autorizaciones (PR-013/014).

## 🚩 Flag crítico — reserva ausente en el modelo (decidido con el dueño)

`PedidoVenta`/`ItemPedidoVenta` (`schema.prisma:2108-2140`) **no tienen ningún campo de reserva**: ni
`cantidadReservada`, ni validez/expiración, ni estado de reserva. Por eso la OD-02 (badge tri-estado de
reserva, "Expira en X días", columna *Cantidad reservada*) **no tiene dato de origen** → **OMITIDA**. NO se
agregó schema. **Decisión del dueño: "Seguir + rastrear conversión"** — en su lugar mostramos **conversión a
venta**, 100% derivable de las ventas vinculadas (`pedidoVentaId`):
- `Cant. solicitada` = `ItemPedidoVenta.cantidad`.
- `Cant. convertida` = Σ `ItemVenta.cantidad` de ventas vinculadas **no canceladas**, agrupado por
  `productoId`, **cap-eado por línea** a la cantidad solicitada (la action de conversión no tiene tracking
  parcial ni idempotencia → llamarla 2× crearía ventas duplicadas; el cap evita "convertida > solicitada").
- `Cant. pendiente` = `solicitada − convertida`; badge "Convertido X%" en el Resumen.

**Flag secundario — auditoría del pedido inexistente:** `pedidos-venta.ts` no llama `registrarAuditoria`, así
que `AuditLog` con `tabla="PedidoVenta"` está vacío. Consecuencias (sin tocar las actions de negocio):
`responsable` del header = "—" (no hay `creadoPor` en el schema); `última actualización` usa
`PedidoVenta.updatedAt` **sin** "por <usuario>"; la pestaña Historial muestra "Sin historial de cambios."
hasta que se instrumente la auditoría del pedido (fuera de alcance).

## Qué cambió

### Cabecera — `AdaptiveRecordHeader` (reuso PR-018)
7 campos: Código (`Pedido {numero}`), Status (`StatusBadge`), Cliente (`EntityLink`), Valor (Total estimado
dual ARS+USD, sin IVA), Responsable (`—`), Fecha / Fecha prevista / Moneda·TC / Última actualización. El
`StatusBadge` se reusa verbatim: BORRADOR/CONFIRMADO/PARCIAL/CANCELADO están mapeados; **ENVIADO/COMPLETADO
caen en `neutral`** (no se toca el componente compartido — sería otro PR). Sticky-reduce heredado.

### Pestañas (Resumen-first … Historial-last)
`["resumen", "items"(=Items/Operación), "autorizaciones", "historial"]`, `resolveActiveTab(..., "resumen")`.
**Sin pestaña Entregas**: la entrega pertenece a la `Venta` (no hay FK pedido→entrega); el equivalente del
pedido es el bloque "Conversión a venta".
- **Resumen** (NUEVA, `pedido-venta-resumen-view.tsx`) — dos columnas: izquierda (Próxima acción + cliente +
  comercial + preview de 5 ítems + **Conversión**); derecha (Total estimado + bloque de margen total gated).
- **Items / Operación** (`pedido-venta-items-view.tsx`) — grade densa derivada (ver abajo).
- **Autorizaciones** — `AutorizacionesTab tabla="PedidoVenta"` reusado verbatim (la page anterior ya lo usaba).
- **Historial** — `AuditTrail` con `getAuditLog("PedidoVenta", …)` (vacío, ver flag secundario).

### Grade de ítems (mapeo a las 16 columnas OD-02)
**DISPLAY (10):** # · Producto (código+nombre) · Cant. solicitada · Cant. convertida · Cant. pendiente ·
Precio unit. · Total neto · Margen %* · Margen valor* · Estado línea (derivado: Convertida/Parcial/Pendiente,
o Cancelada si el pedido está cancelado). Margen (% y valor) está gated por permiso (PR-011): **la columna no
se renderiza sin `verMargen`**, y el costo no se computa server-side cuando falta permiso (no se filtra al
cliente). **OMITIDAS (6):** SKU (`Producto` sólo tiene `codigo`), Cant. reservada (sin reserva), Stock
disponible/post (el ítem no tiene depósito), Descuento e IVA (el pedido no los modela; el IVA se calcula al
convertir).

### Faixa de Alertas + Próxima acción (sólo datos ya cargados)
Reusa `VentaAlertasBand` (presentacional, DRY). Deriva: pedido cancelado, autorización pendiente, cliente
bloqueado, unidades pendientes de facturar. Próxima acción por estado: BORRADOR→enviar; ENVIADO→confirmar;
CONFIRMADO/PARCIAL→convertir a venta; COMPLETADO→sin acciones; CANCELADO→sólo lectura.

### Edición / acciones en FloatingWorkWindow (G-04)
- `pedido-edit-window.tsx` (espejo `venta-edit-window.tsx`): botón **Editar** (BORRADOR/ENVIADO) →
  `FloatingWorkWindow` maximizable que **hospeda el `PedidoVentaForm` existente** `embedded`. `useDirtyState`
  + `onRequestClose` + Dialog "Descartar cambios". Se conserva el footer propio del form (total estimado).
- `pedido-detail-actions.tsx` (espejo `venta-detail-actions.tsx`): `MonedaToggle` + transiciones
  (`transicionarPedidoVentaAction` **verbatim**: Marcar enviado / Confirmar / Marcar completado) +
  **Convertir a venta** (`crearVentaDesdePedidoAction`, conversión total — sin parcial) + **Cancelar pedido**
  (Dialog de confirmación). Se sacó "Convertir" y "Cancelar" del Dialog lateral del detalle bespoke.
- Se **eliminó** el branch full-page `?editar=1` y el componente `pedido-venta-detail.tsx` (sólo lo usaba la
  page); la edición ahora vive 100% en la ventana.

### Margen (decisión PR-018 espejada)
`margen-pedido-resumen.ts` (total) y `margen-pedido-linea.ts` (por línea) **REUSAN** `calcularMargenNetoVenta`
+ `sumarCostoItems` (`margen-aprobacion-faixas`). El pedido no tiene subtotal almacenado (se deriva Σ
precio×cant) ni flete/percepción IIBB (entran 0). PR-011 en doble capa: el reader devuelve `null` sin
`costos.ver`; la UI gatea con `puedeVerMargen()`.

### `PedidoVentaForm` (cambios SÓLO aditivos y opcionales — espejo PR-018)
Props nuevas `embedded?`, `onCancel?`, `onSuccess?`, `onDirtyChange?`. `embedded` → footer in-flow
(`sticky bottom-0`, sin `fixed`/`pb-32`); Cancelar → `onCancel ?? router.back()`; éxito → `onSuccess ??
(router.push+refresh)`; `formState.isDirty` se burbujea por `onDirtyChange`. **Grade, cálculo, schema y
validación intactos.** `/ventas/pedidos/nuevo` no pasa estas props → comportamiento idéntico.

### `obtenerPedidoVentaPorId`
Ahora expone `updatedAt` en `PedidoVentaDetalle` (consumido por el header). Las actions de negocio
(`transicionar`/`crearVenta`/`guardar`) quedan **verbatim**.

## Lo que NO se tocó
`schema.prisma`/migrations/auth/permisos/cualquier motor; grade/cálculo del `PedidoVentaForm`; las 3 actions
de pedido; conversión parcial (la action sólo convierte todo); máquina de estados (transición sin validación,
comportamiento actual); reserva real; stock disponible/post; `StatusBadge`; el record de Venta (PR-018), la
worklist (PR-017) ni otros módulos. Sin masking propio (consume PR-011), sin flujo de aprobaciones (consume
PR-013/014).

## Archivos
**Nuevos:** `ventas/pedidos/[id]/_components/{pedido-edit-window,pedido-detail-actions,pedido-venta-resumen-view,pedido-venta-items-view}.tsx`,
`lib/services/{margen-pedido-resumen,margen-pedido-linea}.ts`, este doc.
**Modificados:** `ventas/pedidos/[id]/page.tsx` (reescrita a RecordLayout), `lib/actions/pedidos-venta.ts`
(`updatedAt`), `ventas/pedidos/_components/pedido-venta-form.tsx` (props aditivas).
**Eliminados:** `ventas/pedidos/_components/pedido-venta-detail.tsx`.

## Verificación
`pnpm prisma generate && pnpm typecheck && pnpm build && pnpm biome:ci && pnpm test`. Las actions/motor no se
tocan → los tests existentes deben quedar verdes. QA visual con Postgres descartable (memoria
`reference_qa_local_env_override`; nunca `pnpm dev` crudo → habla con PROD).
