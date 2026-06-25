# IMPLEMENTATION_NOTES — PR-008 · Audit Foundation

**Fecha:** 2026-06-25
**Branch:** `pr-008-audit-foundation` (ramificada de `main` @ `754b3987`)
**Wave:** 0 — mitad "auditoría" de los no-negociables (G-07 / CRIT-11).

## Objetivo

Extender la fundación de auditoría para que *toda alteración relevante* pueda
registrar **motivo/origen + IP + tipos de evento ricos**, y probarlo en un
**piloto seguro** (maestros de bajo riesgo) — **sin** tocar auth/permisos
(PR-006/007) ni ningún motor de cálculo (comex/finanzas/contabilidad/margen/
stock/costeo). Desbloquea PR-010 (página global AUD-01) y el wiring por módulo.

El PR **toca el schema a propósito**, pero **sólo de forma aditiva y
retrocompatible**.

## Adiciones de schema (`prisma/schema.prisma`)

Migración: **`<timestamp>_add_audit_metadata`** (Prisma Migrate / `prisma migrate dev`,
NO `db push`). Reversible: sólo `ALTER TABLE ... ADD COLUMN` + `ALTER TYPE ... ADD VALUE`.

- **Nuevo enum `AuditOrigen`**: `MANUAL`, `IMPORTACION`, `AUTOMACION`, `API`, `MASTER_OVERRIDE`.
- **`enum AuditAccion`** — valores AÑADIDOS (se mantienen `CREATE`/`UPDATE`/`DELETE`):
  `CAMBIO_ESTADO`, `APROBACION`, `CANCELACION`, `EXPORTACION`, `VISUALIZACION_SENSIBLE`, `MASTER_OVERRIDE`.
- **`model AuditLog`** — columnas AÑADIDAS:
  - `motivo String?` (nullable)
  - `origen AuditOrigen @default(MANUAL)` (NOT NULL con default → backfillea filas previas a `MANUAL`)
  - `ip String?` (nullable)
  - `documentoId String?` (nullable)
- Índices existentes preservados (`@@index([usuarioId])`, `@@index([tabla, registroId])`).

**Sin drops, sin renames, sin columna obligatoria sin default.**

## Servicio de auditoría (`src/lib/services/auditoria.ts`)

- `RegistrarAuditoriaInput` extendido con campos **opcionales**: `motivo?`, `origen?`, `ip?`, `documentoId?`.
- En `auditLog.create`: `motivo/ip/documentoId` ⇒ `?? null`; `origen` sólo se setea
  cuando viene (si se omite, aplica el default `MANUAL` del schema).
- `AuditEntry` extendido con `motivo: string | null`, `origen: AuditOrigen`, `ip: string | null`;
  `getAuditLog` los mapea (el `findMany` ya devuelve todos los scalars).
- **Firma retrocompatible**: los callers previos (proveedores ×4, ventas ×4) no
  pasan ningún campo nuevo → compilan y graban idéntico (columnas nuevas = null / origen MANUAL).

## Timeline (`src/components/ui/audit-trail.tsx`)

- Render **aditivo** vía subcomponente `EntryMeta` (mantiene complejidad ciclomática ≤ 8):
  - `origen`: sólo cuando `!== MANUAL` (mapa `ORIGEN_LABEL`).
  - `ip`: sufijo discreto "· IP {ip}" cuando presente.
  - `motivo`: línea propia "Motivo: …" cuando presente.
- Etiquetas legibles añadidas en `ACCION_META` para los nuevos `AuditAccion`.
- **Filas previas (origen=MANUAL, motivo/ip null) se ven idénticas** a antes.

## Piloto — wiring en maestros de bajo riesgo

Patrón copiado de `src/lib/actions/proveedores.ts`. En **clientes, depósitos y
productos** (crear/actualizar/eliminar — 9 actions):

1. `const session = await auth()` → `const usuarioId = await requireSessionUser()`
   (helper existente `src/lib/auth-guard.ts`, fuera del try/catch; valida que el
   User del JWT existe → evita P2003 en la FK `AuditLog.usuarioId`). Import `auth`
   eliminado (quedaba sin uso).
2. Mutación envuelta en `db.$transaction` (atómico: o muta + audita, o nada).
3. Snapshot before/after vía `SNAPSHOT_*` (campos JSON-safe; `Decimal` → `Number()`):
   `SNAPSHOT_CLIENTE`/`serializarCliente` (alicuotaPercepcionIIBB Decimal),
   `SNAPSHOT_DEPOSITO` (todo scalar),
   `SNAPSHOT_PRODUCTO`/`serializarProducto` (diePorcentaje/precioVenta Decimal).
4. `registrarAuditoria(tx, …)` con `tabla` = `"Cliente"` / `"Deposito"` / `"Producto"`:
   - crear → `CREATE` (`datosNuevos`).
   - actualizar → `UPDATE` (`datosAnteriores` + `datosNuevos`).
   - eliminar → soft-delete: `UPDATE` (`{...antes, estado/activo}`); hard-delete: `DELETE` (`datosAnteriores`).
5. **motivo**: los forms de estos maestros no tienen campo motivo → no se captura
   en el piloto (la firma/columna lo soportan; el "motivo obligatorio" en acciones
   destructivas es por-módulo, fuera de este PR). No se tocaron los forms.

## Tab Historial (PAGE-STD-02 — última pestaña)

`clientes/[id]` y `depositos/[id]` (productos fuera de scope del tab). Patrón de
referencia: `proveedores/[id]/page.tsx`.

- `searchParams` + `resolveActiveTab(tab, ["general","historial"], "general")`.
- `db.auditLog.count(...)` para el badge de la pestaña.
- `<RecordTabs>` como primer hijo; contenido actual envuelto en `{activeTab === "general" && …}`;
  `<HistorialTab>` async (`getAuditLog` → `<AuditTrail>`) en `historial`.
- La edit window queda en la `actionBar` (visible en ambas pestañas; sin cambios).

## Retrocompatibilidad

- Filas de `AuditLog` previas: `origen=MANUAL`, `motivo/ip/documentoId=NULL` (backfill).
- Call-sites previos (proveedores/ventas): comportamiento idéntico.
- `getAuditLog`/`AuditTrail` en ventas/proveedores/asientos: render inalterado.
- Enum aditivo: no afecta consumidores actuales.

## No-objetivos (NO hechos en este PR)

- NO se tocó auth/JWT/sesión ni el modelo de permisos (PR-006/007).
- NO se tocó comex/finanzas/contabilidad/margen/stock/costeo ni motores de cálculo.
- NO se agregó "motivo obligatorio" en acciones destructivas de negocio (anular
  venta/asiento, reabrir período/costo, etc.).
- NO se implementó wiring de `VISUALIZACION_SENSIBLE`/`EXPORTACION` (sólo los
  valores del enum; el wiring es de PR-010/PR-011).
- NO se construyó la página global AUD-01 (PR-010).

## Verificación

`pnpm prisma generate` · `pnpm db:migrate --name add_audit_metadata` (contra
Postgres local descartable, NUNCA prod) · `pnpm typecheck` · `pnpm build` ·
`pnpm biome:ci` · `pnpm test`.

QA manual: crear/editar/eliminar un cliente y un depósito → abrir
`clientes/[id]?tab=historial` y `depositos/[id]?tab=historial` → ver eventos
CREATE/UPDATE/DELETE con autor y diff. Confirmar que proveedores/ventas siguen idénticos.
