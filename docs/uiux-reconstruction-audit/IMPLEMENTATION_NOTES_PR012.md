# PR-012 — Approvals Engine (AUTO-01 / CRIT-03)

> Motor genérico y reutilizable de aprobaciones (request → decisión → SLA →
> escalonamiento), **INERTE por defecto** y **NO cableado** a ninguna acción de
> negocio. Desbloquea PR-013 (Central de Aprobaciones UI) y PR-014 (flujo de
> margen COM-05). Consume PR-006 (RBAC `hasPermission` + catálogo de permisos) y
> PR-008 (`registrarAuditoria`). Toca el schema de forma **aditiva y genérica**.

## Decisiones del dono (esta sesión)
1. **Matriz: sólo catálogo de claves.** Se agregan las claves `aprobar.<tipo>` al
   `PERMISSION_CATALOG` (ADMIN/Master las recibe vía `seedRbacFoundation`); los 11
   perfiles canónicos quedan **vacíos** y el Master los asigna por la UI de PR-009.
   **`prisma/seed.ts` NO se modifica.**
2. **Terminal de escalonamiento: EXPIRADA.** Al agotar gestor→Diretor→Master sin
   decisión, la solicitud queda **EXPIRADA** (no hay auto-aprobación por
   vencimiento). El Master override sigue disponible como acción **manual**
   explícita (`aprobar({ esMasterOverride: true })`). El campo `autoMasterOverride`
   queda en `false` para todos los tipos (reservado para flexibilidad futura).

## Schema (migración `20260625221138_add_approvals_engine`, aditiva)
- **Enums nuevos:** `EstadoSolicitud` (PENDIENTE/APROBADA/RECHAZADA/EXPIRADA/
  CANCELADA/SOLICITANDO_INFO), `TipoAprobacion` (18 filas de ANEXO A.3),
  `TipoDecisionAprobacion` (APROBADA/RECHAZADA/INFO_SOLICITADA).
- **Modelos nuevos:** `Solicitud` y `Aprobacion`. El documento de negocio se
  referencia **polimórficamente** por `(tabla, registroId)` String/String **sin FK**
  (igual `AuditLog`) → ningún modelo de negocio recibe columnas/FKs.
- **FKs duras a `User`** sólo en `solicitanteId`/`aprobadorId` (`onDelete: Restrict`),
  espejando `AuditLog.usuario`. `User` recibe **sólo back-relations virtuales**
  (`solicitudesSolicitadas`, `aprobacionesRealizadas`) — **cero columnas**, igual
  que el `auditLogs` ya existente. La migración no contiene `DROP`/`ALTER` sobre
  ninguna tabla preexistente (los `ALTER TABLE` son `ADD CONSTRAINT` sobre las
  tablas nuevas).
- `valor Decimal(18,2)?` + `moneda Moneda?` son **metadata de presentación** (la
  worklist de PR-013): el motor NUNCA calcula con ellos.

## Permisos (catálogo, PR-006)
20 claves nuevas en `src/lib/permisos-catalog.ts`, todas `dimension: APROBACION`
(valor ya reservado en el enum): 18 `aprobar.<tipo>` + 2 tiers de escalonamiento
(`aprobar.escalar.director`, `aprobar.masterOverride`). El mapeo perfil→clave de
ANEXO A.3 queda **documentado** en los comentarios de `aprobaciones-matriz.ts`
para la asignación futura por la UI de PR-009.

## Motor (`src/lib/services/`)
- `aprobaciones.ts` — máquina de estados: `crearSolicitud`, `aprobar`, `rechazar`
  (motivo obligatorio), `solicitarInformacion`, `responderInformacion`, `cancelar`.
  Re-exporta `procesarEscalonamientos`.
- `aprobaciones-escalonamiento.ts` — régua SLA + `procesarEscalonamientos` (cron).
- `aprobaciones-shared.ts` — primitivas internas (tx, guards, constantes).
- `aprobaciones-helpers.ts` — helpers **puros** (test seams): `addHoras`,
  `computeHito`, `escalarUnNivel`, `aplicarDupla`, `auditDeAprobacion`, …
- `aprobaciones-matriz.ts` — `MATRIZ_APROBACION` (config tipada, ANEXO A.3 + B).

### Garantías
- **Inerte:** cada función pública **lanza** si `APPROVALS_ENABLED` ≠ `"true"`.
  Ninguna acción de negocio importa el motor. Con la flag off, cero cambio.
- **Sin efectos de negocio:** el motor sólo escribe `Solicitud`/`Aprobacion`/
  `AuditLog`. El EFECTO de una aprobación lo aplica luego la acción gateada (PR-014).
- **Determinismo:** el tiempo entra como `ahora: Date` — el motor no lee el reloj
  (`new Date()` sólo vive en `prisma/escalate-approvals.ts`).
- **Atomicidad:** gate fuera de la tx; mutación + `registrarAuditoria` en la
  **misma** `$transaction` (las funciones aceptan un `tx?` opcional).
- **Complejidad:** funciones extraídas en helpers para mantener ciclomática ≤ 8
  (gate Codacy/Lizard); archivos < 500 nloc.

### Máquina de estados (auditoría)
| Transición | Estado destino | Audit (`accion`/`origen`) |
|---|---|---|
| `crearSolicitud` | PENDIENTE | `CAMBIO_ESTADO`/`MANUAL` |
| `aprobar` (simple · dupla 2ª distinta · master) | APROBADA | `APROBACION`/`MANUAL` (master → `MASTER_OVERRIDE`) |
| `aprobar` (dupla 1ª) | PENDIENTE (parcial) | `APROBACION`/`MANUAL` |
| `rechazar` (motivo obligatorio; veta la dupla) | RECHAZADA | `CAMBIO_ESTADO`/`MANUAL` |
| `solicitarInformacion` | SOLICITANDO_INFO | `CAMBIO_ESTADO`/`MANUAL` |
| `responderInformacion` (solicitante/admin) | PENDIENTE | `CAMBIO_ESTADO`/`MANUAL` |
| `cancelar` (solicitante/admin; motivo) | CANCELADA | `CANCELACION`/`MANUAL` |
| escalonamiento 100% (tier no terminal) | (igual) +nivel | `CAMBIO_ESTADO`/`AUTOMACION` |
| escalonamiento 100% (último tier) | **EXPIRADA** | `CAMBIO_ESTADO`/`AUTOMACION` |

> `RECHAZO` **no** es un valor de `AuditAccion` (PR-008 dueño del enum): el rechazo
> es `Solicitud.estado=RECHAZADA` + `Aprobacion.decision=RECHAZADA`, auditado como
> `CAMBIO_ESTADO`. **No** se agregó ningún valor al enum de auditoría.

### SLA + escalonamiento (ANEXO B + régua AUTO-01)
- SLA por tipo del config (`MATRIZ_APROBACION`). Tras escalar, el nuevo aprobador
  recibe **50%** del SLA original (`escalarUnNivel`).
- `procesarEscalonamientos(ahora)`: por fila (en su **propia** tx) calcula la banda
  (50/75/100%); emite recordatorios **idempotentes** (`ultimoHitoSla`, sólo si la
  banda subió); al vencer **avanza exactamente un nivel por pasada** (resetea
  `venceEn = ahora + SLA/2` y `ultimoHitoSla = 0`); al agotar la cadena → EXPIRADA.
  **No envía notificaciones**: devuelve intents (claves destinatarias) para que el
  consumidor (cron) loguee/notifique.
- Mapeo de tiers: `escalonamiento = [aprobar.escalar.director, aprobar.masterOverride]`
  (2 tiers tras el aprobador base). El "gestor" de la régua se notifica en la banda
  75%; los escalonamientos del 100% van a Diretor y luego Master.

### Cron stub (INERTE por dos candados)
- `prisma/escalate-approvals.ts` (`pnpm db:escalate-approvals`) — único lugar con
  `new Date()`; sale **no-op** si la flag está off.
- `.github/workflows/escalation-approvals.yml` — `workflow_dispatch`-only, **sin
  bloque `schedule:`**. Para activar: agregar `schedule:` + `APPROVALS_ENABLED=true`
  (fuera del alcance de PR-012).

## Feature flag
`isApprovalsEnabled()` en `src/lib/features.ts` (`APPROVALS_ENABLED`, default **OFF**).

## Tests (47 nuevos)
- **Puros (sin Docker):** `aprobaciones-matriz.test.ts` (completitud · parity
  catálogo · SLA ANEXO B · dupla), `aprobaciones-helpers.test.ts` (bandas, ventanas,
  escalar, dupla, audit map).
- **Testcontainers:** `test/aprobaciones-engine.test.ts` (transiciones, dupla,
  veto-por-rechazo, motivo obligatorio, SOLICITANDO_INFO, cancelar, denegación de
  permiso, master override, flag-off inerte) y `test/aprobaciones-escalation.test.ts`
  (50/75/100% + idempotencia, un nivel por pasada, EXPIRADA terminal, flag-off).

## Prueba de no-alteración
- Archivos tocados: `prisma/schema.prisma` (2 modelos + 3 enums + 2 back-relations
  de User), la migración, `permisos-catalog.ts` (append), `features.ts` (append),
  `package.json` (1 script), los módulos nuevos del motor, el script + el yml, los
  tests y estas notas. **Ninguna acción de negocio fue modificada.**
- Modelos de PR-006 (permisos) y PR-008 (auditoría) **intactos** (sólo consumidos /
  data de catálogo). Sin `git pull`/`git add .`/commit/push.

## Validación
`pnpm prisma generate` · `pnpm db:migrate` (creada contra Postgres local descartable,
NUNCA prod) · `pnpm typecheck` · `pnpm build` · `pnpm biome:ci` · `pnpm test`.
