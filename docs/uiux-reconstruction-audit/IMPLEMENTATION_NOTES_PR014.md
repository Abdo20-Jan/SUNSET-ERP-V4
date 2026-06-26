# PR-014 — COM-05 Margin Authorization (gate de margen en la emisión)

Cierra la **Onda 1** y es la **PRIMERA PR de enforcement**: liga el motor de
aprobaciones (PR-012) + la UI de Autorizaciones (PR-013) al flujo de Venta, sobre
RBAC (PR-006/007) y el masking de margen (PR-011). Una venta con margen bajo el
piso debe tener una `Solicitud` **APROBADA** antes de poder emitirse.

**INERTE por defecto**: con `APPROVALS_ENABLED` off (default) la precondición
retorna `{ok:true}` en la 1ª línea sin tocar la DB → comportamiento idéntico al
actual. Con la flag ON, sólo las ventas bajo el piso se bloquean; las que están
sobre el piso no se ven afectadas.

**No recalcula ni toca el efecto**: sólo LEE la margen (espelhando exactamente el
cálculo de `venta-form`) y AGREGA una precondición al tope de `emitirVentaAction`.
El asiento/stock (`crearAsientoVenta` / `contabilizarAsiento` / reservas / entrega)
queda **byte-idéntico** — la precondición corre ANTES de la transacción.

## Alcance entregado

1. **Config de faixas (CRIT-03)** — `src/lib/services/margen-aprobacion-faixas.ts`
   (PURO, client-safe, sin `server-only`):
   - `resolverFaixaMargen(margenPct)` data-driven mapea el margen neto % al
     `TipoAprobacion`: `(-5,0)`→`MARGEN_BAJA_5`, `(-10,-5]`→`MARGEN_BAJA_10`,
     `(-15,-10]`→`MARGEN_BAJA_MAYOR_10`, `<=-15`→`MARGEN_BAJA_MAYOR_10`
     (`requiereMaster` = metadato doc-only). El borde pertenece al tier MÁS severo
     (−5,00 ⇒ BAJA_10; −10,00 ⇒ MAYOR_10). Piso = `0%` (sólo margen negativo dispara).
   - `tiposMargenAlMenos(tipo)` — conjunto de severidad para el match del gate.
   - `calcularMargenNetoVenta(...)` / `sumarCostoItems(...)` — ESPELHAN `venta-form`
     (`costoTotal` SIN redondeo intermedio; provisión 35% sólo si bruta>0; `decimal.js`
     directo, no `@/lib/decimal` que importa Prisma).

2. **Precondición de emisión** — `src/lib/services/margen-aprobacion.ts` (`server-only`):
   - `verificarAprobacionMargenVenta(ventaId)` → `{ok:true} | {ok:false; error}`.
     Flag off → `ok`; venta inexistente → `ok` (lo maneja el guard del emit); sobre
     el piso → `ok`; bajo el piso → exige una `Solicitud` **APROBADA** de tipo igual
     o más severo (`tipo: {in: tiposMargenAlMenos(faixa.tipo)}`, `estado: APROBADA`).
   - `resolverFaixaMargenVenta(ventaId)` (read-only, no gateada) — la usa la UI del
     BORRADOR para el badge.
   - Insertada en `emitirVentaAction` (`src/lib/actions/ventas.ts`) entre
     `requireSessionUser()` y el `try`/`$transaction` (2 líneas). Un emit bloqueado
     retorna `{ok:false}` antes de la tx → la venta queda en BORRADOR, sin asiento/
     stock/entrega/audit.

3. **UI**
   - **Venta BORRADOR** (`venta-form.tsx`, aditivo y flag-gated): badge "Requiere
     autorización de margen" + botón "Solicitar autorización" (reusa
     `SolicitarAutorizacionWindow` con `tiposPermitidos=[faixa.tipo]`, semeando el
     tipo correcto). Con costo visible usa la margen LIVE; enmascarado usa el flag
     del server (`tipoMargenRequerido`, snapshot del último guardado). La página
     `ventas/[id]/page.tsx` (rama BORRADOR) computa la faixa server-side sólo con la
     flag ON y la pasa al form.
   - **Venta emitida**: la aba `Autorizaciones` ya estaba cableada por PR-013 (sin cambio).
   - **Pedido** (`ventas/pedidos/[id]/page.tsx`): se agregó una capa mínima de
     `RecordTabs` ("General" = `PedidoVentaDetail` actual; "Autorizaciones" =
     `AutorizacionesTab` con `tabla="PedidoVenta"`). INERTE con la flag off. No se
     migró `PedidoVentaDetail` (fuera de alcance Onda 2).

4. **Tests** — `test/margen-aprobacion.test.ts`: faixas y bordes (0/-5/-10/-15);
   margen golden (provisión 35%, pérdida -10/-5, subtotal 0); `sumarCostoItems` sin
   redondeo; `tiposMargenAlMenos`; gate (flag off sin tocar DB, sobre el piso, venta
   inexistente, bloqueo sin/pending, permiso con APROBADA exacta, sobre-aprobación
   cubre, sub-aprobación bloquea).

## Garantías

- **Inerte (flag OFF)**: `verificarAprobacionMargenVenta` retorna en la 1ª línea sin
  DB; la UI/aba ya cortocircuitan a vacío. El gate sólo LEE — nunca llama
  `crearSolicitud` (que lanzaría con la flag off).
- **Byte-idéntico (camino permitido)**: el gate corre fuera de la tx; en `{ok:true}`
  el cuerpo de la transacción es literalmente el mismo. Regresión = las suites de
  emit/asiento existentes siguen verdes con la flag off.

## Decisiones y limitaciones documentadas

- **Tier <−15%/negativa**: colapsado en `MARGEN_BAJA_MAYOR_10` (no hay 4º enum sin
  tocar schema). La matriz ya exige `requiereDupla` en ese tipo (dos aprobadores
  distintos). El "Master obrigatório" del spec NO se enforce: `requiereMaster` es
  metadato documental. Un tier propio `MARGEN_BAJA_MAYOR_15` (enum + fila de matriz)
  queda para una PR futura con migración.
- **Piso global = 0%**: sólo el margen negativo dispara aprobación. El piso por
  producto/lista del spec ("mínimo configurado") queda adiado — `Producto` no tiene
  campo de margen mínimo (requeriría schema).
- **Margen no persistida**: se reconstruye read-only desde campos almacenados
  (`Venta.subtotal/flete/percepcionIIBB`) + `Producto.costoPromedio` (misma base de
  costo que `crearAsientoVenta`; PR-011 sólo enmascara el output, el server lee el
  costo real). Posible divergencia sub-centavo entre Σ `ItemVenta` y `Venta.subtotal`
  redondeado en un borde exacto de faixa — aceptada/documentada.
- **Enforcement sólo en `emitirVentaAction`** (único aplicador de efecto): cubre
  también las ventas originadas en pedido (siempre se emiten ahí). No hay gate rígido
  en la conversión pedido→venta (sólo aba + UI de solicitud informativa en el pedido).
- **Match por severidad**: el gate acepta una APROBADA del tipo exigido o de uno más
  severo (sobre-aprobar cubre; sub-aprobar bloquea). En el BORRADOR el tipo se semea
  por la faixa computada, evitando el desajuste en origen.

## Archivos
- **Nuevos**: `src/lib/services/margen-aprobacion-faixas.ts`,
  `src/lib/services/margen-aprobacion.ts`, `test/margen-aprobacion.test.ts`,
  este documento.
- **Modificados**: `src/lib/actions/ventas.ts` (2 líneas + import),
  `src/app/(dashboard)/ventas/_components/venta-form.tsx` (UI aditiva),
  `src/app/(dashboard)/ventas/[id]/page.tsx` (props al form en BORRADOR),
  `src/app/(dashboard)/ventas/pedidos/[id]/page.tsx` (aba Autorizaciones).
