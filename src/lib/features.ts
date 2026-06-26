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
 *    y el asiento usa la cuenta provisória `1.1.7.90 MERCADERIAS A ENTREGAR`
 *    en lugar de `1.1.7.01 MERCADERÍAS`.
 *  - Entrega (remito) confirmada genera `MovimientoStock` tipo EGRESO,
 *    decrementa `cantidadFisica` y `cantidadReservada`, y emite asiento
 *    DEBE `1.1.7.90` / HABER `1.1.7.01` con el costo capturado en el
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

/**
 * Feature flag: retención de Impuesto a las Ganancias (RG 830) al pagar
 * facturas de proveedores. Sunset actúa como agente de retención.
 *
 * **Cuando está OFF (default)**: el flujo de pago (`crearMovimientoTesoreriaAction`)
 * opera exactamente como hoy — sin detectar ni aplicar retención. Cero
 * regresión: los campos fiscales del proveedor y las tablas
 * `RetencionPracticada` / `ParametroRetencion` existen pero no se tocan.
 *
 * **Cuando está ON**: al registrar un PAGO en ARS a un único proveedor
 * marcado `sujetoRetencionGanancias`, el sistema calcula la retención
 * (acumulado mensual RG 830), paga el NETO al proveedor, genera el pasivo
 * `2.1.3.07 RETENCIONES GANANCIAS A PAGAR` y registra la `RetencionPracticada`
 * con su certificado.
 *
 * **Activación**: setear `RETENCION_GANANCIAS_ENABLED=true`. Default: off.
 *
 * **Pre-requisitos** antes de prender la flag:
 *  1. `pnpm db:push` ejecutado (campos del proveedor + tablas de retención).
 *  2. `ParametroRetencion` seedeado con las reglas RG 830 vigentes.
 *  3. Proveedores sujetos marcados (`sujetoRetencionGanancias` + `conceptoRG830`
 *     + `condicionGanancias`).
 */
export function isRetencionGananciasEnabled(): boolean {
  return process.env.RETENCION_GANANCIAS_ENABLED === "true";
}

/**
 * Feature flag: top-nav global (PR-002 → cutover PR-015 — reconstrucción UI/UX).
 * El shell global (menú superior textual jerárquico + pestañas internas +
 * búsqueda global, exigido por G-02) es el chrome **por defecto** desde el
 * cutover.
 *
 * **Default (sin la variable, o cualquier valor ≠ `"false"`)**:
 * `(dashboard)/layout.tsx` monta `<AppShell>` (top-nav + abas internas +
 * GlobalSearch + breadcrumb + favoritos), SIN sidebar. Ninguna ruta cambia: el
 * menú sólo re-rotula/agrupa rutas existentes (ver `nav-model.ts`).
 *
 * **Kill-switch / rollback**: setear `TOP_NAV_ENABLED=false` (literal) restaura
 * el shell legado (`AppTopnav`) intacto. El cluster legado se mantiene en el
 * árbol un release para permitir el rollback por flag; su remoción física queda
 * para un PR posterior (PR-015b), recién tras un release de soak verificado.
 *
 * **Sin pre-requisitos** de datos/migración: es puramente de presentación.
 */
export function isTopNavEnabled(): boolean {
  return process.env.TOP_NAV_ENABLED !== "false";
}

/**
 * Feature flag: RBAC (PR-006) — perfiles + permisos granulares (G-06/CRIT-10).
 *
 * **Cuando está OFF (default)**: comportamiento legacy de dos niveles — ADMIN
 * vs. usuario activo. El motor `@/lib/permisos` delega en los guards existentes
 * (`requireAdmin`/`requireAdminPage`) y NO toca las tablas nuevas
 * (Perfil/Permiso/UsuarioPermiso). Cero regresión.
 *
 * **Cuando está ON**: el motor resuelve el set efectivo de permisos desde la DB
 * — (grants del perfil) ∪ (UsuarioPermiso concedido y no vencido) − (revokes) —
 * con fast-path ADMIN y fallback por rol cuando `perfilId` es null. El login
 * además graba el set en el JWT como conveniencia para el FE (PR-007).
 *
 * **Activación**: setear `RBAC_ENABLED=true`. Default: off.
 *
 * **Pre-requisitos** antes de prender la flag:
 *  1. Migración `add_rbac_foundation` aplicada (tablas Perfil/Permiso/etc.).
 *  2. Seed de perfiles de sistema ADMIN/USER (`esSistema`) + catálogo de
 *     permisos ejecutado (`seedRbacFoundation` en `prisma/seed.ts`).
 */
export function isRbacEnabled(): boolean {
  return process.env.RBAC_ENABLED === "true";
}

/**
 * Feature flag: motor de aprobaciones (PR-012 · AUTO-01 / CRIT-03) — máquina
 * de estados genérica request → decisión → SLA → escalonamiento.
 *
 * **Cuando está OFF (default)**: el motor queda INERTE. Ninguna acción de
 * negocio lo invoca, y cada función pública de `@/lib/services/aprobaciones`
 * lanza si se la llama con la flag apagada. Las tablas Solicitud/Aprobacion
 * existen pero quedan vacías. Cero cambio de comportamiento en toda la app.
 *
 * **Cuando está ON**: las acciones gateadas que se cableen más adelante
 * (PR-014 cablea margen) pueden crear solicitudes y el motor rastrea su estado
 * de aprobación (sin efectos de negocio — el efecto lo aplica la acción gateada).
 *
 * **Activación**: setear `APPROVALS_ENABLED=true`. Default: off.
 *
 * **Pre-requisitos** antes de prender la flag:
 *  1. Migración `add_approvals_engine` aplicada (tablas Solicitud/Aprobacion).
 *  2. Catálogo de permisos `aprobar.*` sembrado (`seedRbacFoundation`) y, con
 *     RBAC ON, los perfiles canónicos con sus claves de aprobación asignadas.
 */
export function isApprovalsEnabled(): boolean {
  return process.env.APPROVALS_ENABLED === "true";
}
