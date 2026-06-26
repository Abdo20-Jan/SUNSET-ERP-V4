# PR-013 — Central de Aprobaciones (AUTO-01 UI)

Capa de **UI** sobre el motor de aprobaciones de PR-012. Consume el motor, está
gateada por PR-006/PR-007 y adopta los patrones de UI existentes
(EnterpriseDataGrid / RecordTabs / FloatingWorkWindow / PermissionGate). **Inerte
por defecto** y **sin enforcement**: crear una solicitud NO bloquea ninguna acción
de negocio (eso es PR-014+).

## Alcance entregado

1. **Ruta `/sistema/aprobaciones`** (worklist central), gateada en BE
   (`requirePermissionPage(APROBACIONES_VER)`) + FE (`PermissionGate variant=page`).
   - Grid `EnterpriseDataGrid`: columnas Solicitante · Tipo · Documento (EntityLink) ·
     Valor (MoneyAmount) · Estado (StatusBadge) · SLA (color âmbar 50/75, vermelho 100) ·
     Aprobador. Orden por SLA (venceEn asc).
   - Filtros server-driven (`?vista=&tipo=&estado=&solicitante=&sla=`) + sub-vistas
     preset (Pendientes · Mis pendientes · Por vencer · Resueltas · Todas).
2. **Janela de decisão** (`FloatingWorkWindow`): datos de la solicitud + motivo +
   historial de liberaciones + anexos (read-only) + comentario, con acciones
   **Aprobar / Rechazar (motivo obligatorio) / Solicitar información / Cancelar**.
   Cada acción de aprobación gateada por la clave de su tipo
   (`MATRIZ_APROBACION[tipo].permisoAprobacion`, PermissionGate `variant=button`);
   el motor re-valida. La dupla aprobación la resuelve el motor.
3. **Bloque del Dashboard** (ADITIVO): `AprobacionesPendientesCard` — contador + top 3
   por SLA de lo que espera la decisión del usuario, link a la Central. Retorna `null`
   si no hay pendientes (oculto con la flag off). No reconstruye el dashboard (PR-042).
4. **Aba contextual reutilizable** `AutorizacionesTab` — lista las solicitudes del
   documento + botón genérico **"Solicitar autorización"** que CREA una `Solicitud`
   vía el motor. Cableada como piloto en `ventas/[id]` (tab "Autorizaciones"). Otros
   documentos (Pedido/Asiento/Comex) la adoptan pasando `tabla`/`registroId`/`tiposPermitidos`.

## Archivos

**Nuevos (lectura/acciones, server):**
- `src/lib/services/aprobaciones-constants.ts` — labels TIPO/ESTADO, color SLA, sub-vistas, `TIPOS_VENTA`.
- `src/lib/services/aprobaciones-filtros.ts` — `parseFiltros` + `construirWhereAprobaciones` (puro).
- `src/lib/services/aprobaciones-query.ts` — queries sólo-lectura + DTO `AprobacionRow`/`SolicitudDetalle`.
- `src/lib/actions/aprobaciones.ts` — actions delgadas (aprobar/rechazar/solicitarInfo/cancelar/crear + cargar detalle).

**Nuevos (UI):**
- `src/app/(dashboard)/sistema/aprobaciones/` — `page.tsx`, `aprobaciones-page-gate.tsx`,
  `aprobaciones-worklist.tsx`, `aprobaciones-columns.tsx`, `aprobaciones-filter-bar.tsx`,
  `aprobacion-decision-window.tsx`.
- `src/components/aprobaciones/` — `autorizaciones-tab.tsx`, `solicitar-autorizacion-window.tsx`.
- `src/app/(dashboard)/dashboard/_components/aprobaciones-pendientes-card.tsx`.

**Modificados (aditivo):**
- `src/lib/permisos-catalog.ts` — +1 clave `APROBACIONES_VER` (`aprobaciones.ver`, dimensión `PAGINA`),
  espejando `AUDITORIA_VER`. **No** toca el engine/resolver/seed (el seed la incluye automáticamente).
- `src/components/layout/nav-config.ts` — +item "Aprobaciones" en la sección Sistema, gateado.
- `src/app/(dashboard)/dashboard/page.tsx` — +`<AprobacionesSection>` en `<Suspense>`.
- `src/app/(dashboard)/ventas/[id]/page.tsx` — +tab "Autorizaciones" (aditivo).

## Garantía INERTE (APPROVALS_ENABLED off)

- Las queries de lectura **cortocircuitan a vacío/0 antes de tocar la DB**
  (`if (!isApprovalsEnabled()) return [] / 0 / null`). Con el motor PR-012 inerte
  no hay solicitudes igual; el cortocircuito lo hace explícito y sin overhead.
- Worklist vacía ("No hay aprobaciones pendientes"); bloque del dashboard oculto;
  aba contextual "Sin aprobaciones" y **sin** botón "Solicitar autorización"
  (sólo se renderiza con la flag on). Cero cambio de comportamiento.

## Fronteras respetadas

- **Sin enforcement**: ninguna acción de negocio pasa a depender de una aprobación.
  Crear una solicitud no bloquea facturar/emitir/contabilizar/etc.
- **No** se tocó `schema.prisma`/migraciones, el motor de aprobaciones, el motor RBAC,
  el de auditoría ni el shape de auth/sesión — sólo se consumen.
- Las server actions son delgadas: validan input + delegan en el motor (que ya gatea
  permiso, audita en la misma tx y lanza con la flag off). Errores → `{ ok:false, error }`.

## Decisiones

- **Gating de la página**: clave nueva `aprobaciones.ver` (no se reusó `ADMIN_ACCESO`,
  que dejaría la Central sólo para admins; los aprobadores no siempre son admin).
- **SLA**: banda derivada con `computeHito` (PR-012). Color âmbar en 50/75%, vermelho en 100%.
  Las resueltas no "corren" (banda 0); `EXPIRADA` se muestra como vencida (100).
- **Aprobador** en la worklist: último que actuó, o "Sin asignar" (el ruteo es por permiso,
  no por asignación).
- **Export** de la worklist: **diferido** (el alcance pide columnas/filtros/saved-views;
  el export auditado llega después para no acoplar el motor de auditoría).
- **Anexos**: read-only en la decisión (sin upload nuevo en este PR).

## Tests

- `test/aprobaciones-filtros.test.ts` — parsing/where (puro).
- `test/aprobaciones-query.test.ts` — garantía inerte (flag off → vacío sin DB) + mapeo DTO + SLA.
- `test/aprobaciones-actions.test.ts` — delegación al motor + motivo obligatorio + error flag-off.

## Pendiente (futuro)

- Adopción de `AutorizacionesTab` en Pedido/Presupuesto/Asiento/Comex (Onda 2 record migration).
- Export auditado de la Central. Upload de anexos en la decisión.
- Wire del flujo de margen que CONSUME el motor con enforcement real (PR-014).
