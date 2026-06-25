# IMPLEMENTATION NOTES — PR-010 · AUD-01 (Sistema > Auditoría)

**Branch:** `pr-010-aud-01-page` (desde `main`; PR-006/007/008 ya en `main`).
**Objetivo:** worklist GLOBAL de SÓLO-LECTURA sobre el `AuditLog` (PR-008): buscable, filtrable,
con sub-vistas oficiales, drill-down al registro auditado y exportación AUDITADA — sin mutar
auditoría, sin tocar motores de permisos/auditoría/negocio.

## Ruta + gating

- Ruta: `/sistema/auditoria` → `src/app/(dashboard)/sistema/auditoria/page.tsx` (server,
  `dynamic = "force-dynamic"`).
- **BE:** `requirePermissionPage(PERMISOS.AUDITORIA_VER)` al tope. Export: `requirePermission(
  PERMISOS.AUDITORIA_EXPORTAR)` dentro de la server action (no sólo UI).
- **FE:** `AuditoriaPageGate` (PermissionGate `variant="page"`); el botón de export se enmascara
  con `useHasPermission(AUDITORIA_EXPORTAR)`.
- **Claves nuevas** (catálogo PR-006, aditivo): `auditoria.ver` (PÁGINA) + `auditoria.exportar`
  (EXPORTACIÓN). ADMIN/Master las recibe en el reseed (seed concede TODO el catálogo a ADMIN);
  Diretor/auditor se conceden vía la UI de PR-009. Con RBAC OFF, ambas son admin-scoped ⇒ sólo
  Master (idéntico a las demás páginas de Sistema).

## Mecanismo (server-driven; el grid es display client-side)

`EnterpriseDataGrid` no tiene filtro server, ni date-range, ni multi-select → el filtrado real es
**server-driven vía URL**. `page.tsx` parsea searchParams → `parseFiltros` → `listarAuditoria`
(where + `orderBy fecha desc` + `take CAP_WORKLIST=1000` + `include usuario.nombre`). El grid sólo
resuelve display + quick-search in-page + sort + **expansión (diff)** + freeze + paginación.

## Sub-vistas oficiales = presets de URL (`?vista=`), server-side

NO son SavedViews del grid (que filtran sólo las 1000 filas ya capadas ⇒ "Master overrides" podría
salir vacío por el cap = falla de integridad). Mapeo en `whereDeVista`:

- `todos` → `{}` · `exportaciones` → `EXPORTACION` · `visualizaciones-sensibles` →
  `VISUALIZACION_SENSIBLE` · `aprobaciones` → `APROBACION` ·
  `eventos-criticos` → `accion IN (MASTER_OVERRIDE, CANCELACION, DELETE)` ·
  `master-overrides` → `accion = MASTER_OVERRIDE OR origen = MASTER_OVERRIDE`.
- Limitación spec: "alteración de valor > X" y "reabertura de período" no son codificables desde el
  enum `AuditAccion` → se omiten de `eventos-criticos` (subset alcanzable).

## Filtros

Barra propia (server-driven, escribe en la URL): `desde`/`hasta` (date), `usuario`, `tabla`,
`accion`, `origen` (single-select + sentinel "todos"), `motivo` (`DataTableSearch` debounced,
`contains insensitive`). El AND de `whereDeVista` + `whereDeFiltros` maneja el solape sin lógica de
precedencia. `quickSearch` del grid = refinamiento de texto in-page sobre campos precomputados.

> Nota: la spec menciona multi-select de acción/origen; se aproxima con single-select + las
> sub-vistas (que cubren los agrupamientos OR/IN). El `where` ya soporta `IN` (presets).

## 9 campos canónicos AUD-01 → schema (sin gaps)

Columnas: **Fecha** (data+hora, pinned) · **Usuario** · **Acción** (badge) · **Origen** · **Tabla** ·
**Registro** (EntityLink drill-down) · **Motivo**. Expansión: **Campo / Valor anterior / Valor
nuevo** (vía `diffAuditoria`) + IP + Documento. Todos los 9 campos respaldados por el schema PR-008
→ **NO STOP**. No se tocó `schema.prisma` ni migraciones.

## Drill-down (`auditoria-rutas.ts`)

`resolverRutaAuditada(tabla, registroId)` — `switch/case` por tabla auditable (sin acceso dinámico
por clave). Casos = strings REALES de `registrarAuditoria`: `Cliente/Proveedor/Deposito/Venta` y
**`User`** (no "Usuario"). `Compra`/`Asiento` incluidos future-proof (hoy sin auditar).
**`Producto` OMITIDO** (`/maestros/productos` no tiene ruta `[id]`) → `default` → texto plano. Igual
desconocidas/`AuditLog` → texto plano.

## Exportación AUDITADA

`exportarAuditoria({ params, formato })` (server action, `src/lib/actions/auditoria-export.ts`):
`requirePermission(AUDITORIA_EXPORTAR)` → `listarAuditoria(cap=CAP_EXPORT=50_000)` → `toCsv`/`toXlsx`
→ `auditarExportacion(...)` → devuelve `{ filename, mime, base64 }` (base64 por binario XLSX). NO
toca el `/api/export/[recurso]` genérico (no se generaliza).

- `auditarExportacion` (`src/lib/services/auditar-exportacion.ts`, **archivo nuevo** reutilizable):
  `requireSessionUser` + `getRequestIp` + `registrarAuditoria(db, { tabla:"AuditLog",
  registroId:"export", accion:"EXPORTACION", datosNuevos:{pagina,filtros,columnas,nFilas,formato},
  origen:"MANUAL", ip })`. Si falla, propaga ⇒ no se entrega el archivo sin registrar.

## Inmutabilidad (G-07 / CRIT-11)

Sólo `findMany` sobre AuditLog. Único write = APPEND de un evento `EXPORTACION` (no muta/borra). Sin
editar/borrar eventos, sin comentar-evento (requeriría schema). `registrarAuditoria`/`getAuditLog`
**no modificados** (el wrapper vive en archivo aparte y los consume).

## Archivos

**Nuevos:** `src/app/(dashboard)/sistema/auditoria/{page,auditoria-page-gate,auditoria-worklist,
auditoria-filter-bar,auditoria-columns,auditoria-export-button}.tsx`;
`src/lib/services/{auditoria-constants,auditoria-rutas,auditoria-filtros,auditoria-query,
auditar-exportacion}.ts`; `src/lib/actions/auditoria-export.ts`;
`test/{auditoria-filtros,auditoria-rutas}.test.ts`.

**Modificados (aditivo):** `src/lib/permisos-catalog.ts` (2 claves + 2 entradas);
`src/components/layout/nav-config.ts` (item "Auditoría" en Sistema) y
`src/components/layout/nav-model.ts` (AUD-01 → `active` + href, para el mega-menú real).

## Riesgos / follow-ups

- **Índices:** AuditLog indexa `[usuarioId]` y `[tabla,registroId]`, NO `fecha`/`accion`/`origen`.
  El CAP acota el resultado, no el scan. Follow-up (otro PR, requiere migration): `@@index([accion,
  fecha])`.
- "auditor" no es un perfil sembrado: el gating es por la clave `auditoria.ver` (concedible vía la
  UI de PR-009).
