import "server-only";

/**
 * Feature flag: stock dual (W3) — separa stock disponible (reserva
 * en emisión de venta) de stock físico (baja en entrega).
 *
 * **Cuando está OFF (default)**: comportamiento legacy — la emisión
 * de venta debita CMV / Mercaderías directamente, sin generar
 * MovimientoStock EGRESO. Compras locales no mueven stock.
 *
 * **Cuando está ON**:
 *  - Emisión de venta crea reserva en `StockPorDeposito.cantidadReservada`
 *    y el asiento usa la cuenta provisória `1.1.5.03 MERCADERIAS A ENTREGAR`
 *    en lugar de `1.1.5.01 MERCADERÍAS`.
 *  - Entrega (remito) confirmada genera `MovimientoStock` tipo EGRESO,
 *    decrementa `cantidadFisica` y `cantidadReservada`, y emite asiento
 *    DEBE `1.1.5.03` / HABER `1.1.5.01` con el costo capturado en el
 *    momento de la confirmación.
 *  - Transferencias entre depósitos quedan disponibles (mueven stock
 *    entre `StockPorDeposito` sin generar asiento contable).
 *
 * **Activación**: setear `STOCK_DUAL_ENABLED=true` en las variables de
 * ambiente. Default: off. Recomendado activar primero en staging para
 * validar backfill (ver `scripts/backfill-stock-por-deposito.ts` —
 * todavía pendiente, W3.3).
 *
 * **Pre-requisitos** antes de prender la flag en cualquier ambiente:
 *  1. `pnpm db:push` ejecutado (tablas de W3.0 creadas).
 *  2. Backfill ejecutado (W3.3) para que `StockPorDeposito` refleje
 *     `Producto.stockActual` actual.
 *  3. Depósitos NACIONAL y ZONA PRIMARIA ADUANEIRA cargados (o cualquier
 *     otra nomenclatura propia del ambiente — ver seed.ts).
 */
export function isStockDualEnabled(): boolean {
  return process.env.STOCK_DUAL_ENABLED === "true";
}

/**
 * Feature flag: módulo CRM (W4) — Lead → Pipeline → Cliente, contactos,
 * actividades, scoring, AI summary.
 *
 * **Cuando está OFF (default)**: el módulo `/crm/*` retorna mensaje de
 * "CRM no habilitado" y todas las server actions devuelven error sin tocar
 * la BD. No afecta nada del ERP existente (ventas, compras, tesorería).
 *
 * **Cuando está ON**:
 *  - `/crm/*` queda accesible (leads, oportunidades, pipeline kanban,
 *    actividades, contactos).
 *  - Conversión Lead → Cliente puede crear o vincular registros existentes
 *    en `Cliente` (busca por CUIT cuando provisto).
 *  - Las actividades pueden anexarse a Lead, Cliente u Oportunidad.
 *
 * **Activación**: setear `CRM_ENABLED=true` en las variables de ambiente.
 * Default: off.
 *
 * **Pre-requisitos** antes de prender la flag en cualquier ambiente:
 *  1. `pnpm db:push` ejecutado (tablas de W4.0 creadas).
 *  2. Seed de `PipelineStage` ejecutado (6 stages default).
 */
export function isCrmEnabled(): boolean {
  return process.env.CRM_ENABLED === "true";
}

/**
 * Feature flag: contenedores + desconsolidación + despacho parcial
 * cruzado (Comex ZPA). Modela contêineres físicos, evento de
 * desconsolidación en depósito fiscal, divergencia formal (D9) y
 * despachos parciales que cruzan contêineres.
 *
 * **Cuando está OFF (default)**: comportamiento legacy — el flujo
 * embarque-céntrico (Embarque → ItemEmbarque → Despacho → ItemDespacho)
 * opera sin cambios. Las tablas Contenedor/ItemContenedor/Desconsolidacion/
 * DivergenciaInvestigacion existen pero quedan huérfanas; los counters de
 * ItemContenedor no se usan. Zero regresión.
 *
 * **Cuando está ON**: habilita la captura de packing list por contenedor,
 * la desconsolidación con counters (D1-bis) y el despacho parcial cruzado
 * (Fases 2-4).
 *
 * **Activación**: setear `CONTENEDOR_DESCONSOLIDACION_ENABLED=true`.
 * Default: off. Activar primero en staging.
 *
 * **Pre-requisitos** antes de prender la flag:
 *  1. `pnpm db:push` ejecutado (tablas Fase 1 creadas).
 *  2. `pnpm db:partial-indexes-contenedor --apply` ejecutado (UNIQUE
 *     parciales de ItemContenedor — Q11).
 */
export function isContenedorDesconsolidacionEnabled(): boolean {
  return process.env.CONTENEDOR_DESCONSOLIDACION_ENABLED === "true";
}

/**
 * Feature flag: rastreo unitario de inventario (D1-bis lazy).
 *
 * **Cuando está OFF (default)**: la tabla `UnidadInventario` permanece
 * VACÍA en producción. El día a día opera con los counters agregados de
 * `ItemContenedor` (cantidadDisponible / cantidadEnDespacho /
 * cantidadDespachada). Es el comportamiento normal.
 *
 * **Cuando está ON**: habilita la materialización on-demand de unidades
 * individuales (helper futuro `materializarUnidades`) para casos de
 * recall / garantía / sinistro. NO obliga a materializar — sólo la
 * vuelve disponible.
 *
 * **Activación**: setear `UNIDAD_INVENTARIO_TRACKING_ENABLED=true`.
 * Default: off. Depende de `CONTENEDOR_DESCONSOLIDACION_ENABLED`.
 */
export function isUnidadInventarioTrackingEnabled(): boolean {
  return process.env.UNIDAD_INVENTARIO_TRACKING_ENABLED === "true";
}
