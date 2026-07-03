# IMPLEMENTATION NOTES — PR-028 · Contabilidad CONT-01 (Asientos) + CONT-02 (Plan de Cuentas + Libro Mayor)

- **Branch:** `pr-028-contabilidad-asientos-plan` (limpia de `origin/main` @ `d714abb3` — PR-027 mergeado)
- **Tipo:** worklist-migration + record-migration + Sheet→FWW · Onda 2 · **UI-only, behavior-preserving, motor intocado**
- **Sin dependencia** de las series 025/026/027 (cero overlap de archivos); sin stacking.

## 1) Veredicto REVERSAR GATE (preflight 5) — CASO (b), decidido con el dueño

`anularAsientoAction` (`src/lib/actions/asientos.ts:111`) → `anularAsiento` → `anularEnTx`
(`asiento-automatico.ts:479-595`): exige CONTABILIZADO + período ABIERTO, desvincula documentos
operacionales y hace **flip `estado → ANULADO`. NO crea asiento reverso vinculado, NO acepta
motivo, no hay campo/relación de reverso en el schema** (tampoco existe estado "Reverso" — el enum
tiene 3 estados). El [Reversar] de la spec (Q&A estructural 8) exigiría una action de negocio NUEVA.

**Decisión del dueño (AskUserQuestion en el plan):** el record hospeda el botón **[Anular]**
(rotulado por lo que la action realmente hace), payload verbatim, sin campo de motivo. El
Reversar-con-reverso-vinculado queda como **candidato a follow-up PR**. La action no se modificó.

## 2) Mapa columna OD-07 → fuente (consume-or-omit)

Worklist = EnterpriseDataGrid sobre la proyección NUEVA read-only `listarAsientosWorklist`
(`src/lib/services/asientos-worklist.ts` — MISMO select de la page legada + `periodo.estado` +
doc de origen batch).

| # OD-07 | Columna | Shipped | Fuente |
|---|---|---|---|
| 1 | Número | ✅ (pinned) | `numero` → EntityLink `/contabilidad/asientos/[id]` |
| 2 | Data | ✅ | `fecha` (dd/MM/yyyy) |
| 3 | **Período** | ✅ columna E filtro principal | `periodo.codigo` + badge "Cerrado" si `periodo.estado===CERRADO` |
| 4 | Origem | ✅ (pinned) | `origen` (enum: MANUAL/TESORERIA/COMEX/AJUSTE/GASTO) |
| 5 | Descrição | ✅ | `descripcion` (truncate+tooltip; tachada si ANULADO — verbatim tabla legada) |
| 6 | Debe | ✅ | `totalDebe` (la tabla legada mostraba UNA columna "Total"=totalDebe; OD-07 pide ambas) |
| 7 | Haber | ✅ | `totalHaber` |
| 8 | Status | ✅ (pinned) | `estado` → StatusBadge (3 estados reales; "Reverso" sin backing → omitido) |
| 9 | Documento origem | ✅ | `documentosOrigenPorAsiento` (bi-drill-down, REUSO batch sin N+1) → EntityLink `doc.href`; `—` para manual/sin ruta |
| — | hover usuario/CC/total-USD | ❌ OMITIDO | sin backing en el modelo (usuario sólo vía AuditLog del record; CC no existe en LineaAsiento; USD es metadata POR LÍNEA — visible en el record) |

Congeladas 1/4/8 vía `meta.pinned` — el grid agrupa las pineadas a la izquierda (precedente
fin-cxc, donde Estado pineada aparece 3ª visualmente; mismo criterio).

**Vistas** (presets `?vista=` server-side, lección PR-010 — partición limpia por origen):
`manuales`→MANUAL · `automaticos`→{TESORERIA,GASTO} · `comex`→COMEX · `ajustes`→AJUSTE ·
`anulados`→estado ANULADO (corte ortogonal — en las demás vistas los anulados aparecen tachados,
como hoy). Alternativa `automaticos ⊇ comex` documentada en el helper (cambiar = 1 línea + 1 test).

**Filtros server-driven por URL:** `?periodo=<id>|todos` (select con lista de PeriodoContable;
default = período que contiene hoy — Q&A 3) · `?cuentaId=` (asientos que tocan la cuenta vía
`lineas.some`, usa `@@index([cuentaId])`; **single-select** — la spec pedía multi, sin precedente
en el repo y complica el re-read del export; degradación documentada) · `?desde/?hasta`
(refinamiento opcional). Chips client origen/estado + quickSearch refinan DENTRO de la vista.
**Migración de params legados** (sin deep-links externos, verificado): `estado=ANULADO`→vista
`anulados` (shim en la page) · `q`→quickSearch · `page/perPage`→paginación del grid ·
DateRangeFilter→select de período. Cap del fetch: 2000 filas con aviso server-rendered honesto.

## 3) Sheet→FWW — prueba container-only (el 5º y último drawer de negocio)

| Legado (Sheet) | Nuevo (FWW) | Body | Action |
|---|---|---|---|
| `asiento-detalle-sheet.tsx` | `asiento-detalle-work-window.tsx` | **VERBATIM**: dl Fecha/Origen/Moneda/TC + grilla Código/Cuenta/Referencia/Debe/Haber + Totales + skeleton + mismo `useEffect` de fetch | `getAsientoDetalle` CALL-only, intocado |

Sólo cambia el contenedor (`Sheet` → `FloatingWorkWindow` 760×560, read-only Variante A sin
DirtyFooter — precedente exacto `movimiento-detalle-work-window` 025a). El sheet legado y la tabla
legada (`asientos-table.tsx`, `asientos-filters.tsx`) quedan en árbol **NO importados** = rollback.
El superset USD por línea sigue siendo papel del record `[id]` (sin cambios en su grilla).

## 4) Record `[id]` a PAGE-STD-02

- `RecordHeader` → **`AdaptiveRecordHeader`** (codigo/status/badges período+origen+"Período
  cerrado"/entidad=descripción/valor=totalDebe/meta Fecha·Moneda·TC).
- **`RecordActionBar`** NUEVA: left = **[Ver origen]** (Link `doc.href` del reuso
  `documentoOrigen(id)` — bi-drill-down; disabled+hint para manual/sin ruta — Q&A 9); right =
  `AsientoRecordActions` (client): [Contabilizar] (si BORRADOR) / [Anular] (si CONTABILIZADO) con
  **Dialogs VERBATIM de `asientos-table.tsx:229-266`** → actions existentes con payload
  byte-idéntico (`(asiento.id)`) + `router.refresh()`; "Más acciones" → Link
  `mover-periodo?periodoOrigenId=` (flujo intocado).
- Fetches ADITIVOS display-only en el RSC: `documentoOrigen(id)` + `periodoId/periodo.estado`
  (query estrecha) — **`getAsientoDetalle` NO se extendió** (CALL-only, PR-023b).
- Tabs General (grilla con USD condicional, intocada)/Historial (AuditLog, intocada).

## 5) CONT-02 — árbol 7 columnas + Libro Mayor embebido

- **`getPlanDeCuentasConSaldo`** (`src/lib/services/plan-cuentas-arbol.ts`, proyección compartida
  page+export): armado del árbol por `padreCodigo` movido VERBATIM de la page; saldo =
  `getBalanceSumasYSaldos({fechaHasta: hoy})` sin `fechaDesde`/TC/prune → `saldoFinal` por codigo
  (**roll-up del balance pass-through — JAMÁS recomputado**; trabado por test con fixture
  deliberadamente inconsistente); naturaleza mostrada = `naturalezaEfectiva` (reuso).
- Árbol: 7 columnas (Código+chevron · Nombre · Tipo=categoria · **Naturaleza** · Categoría=tipo
  con **candado** en sintéticas · Estado · **Saldo** mono right, sintética bold); inactivas
  atenuadas + candado; `getRowId=codigo` (keys estables); búsqueda 3+ chars con poda
  matches+ancestros y auto-expansión (restaura el estado previo al limpiar); [Expandir hasta nivel
  1–5] (default 3).
- **Libro Mayor embebido (Q&A 6):** click en ANALÍTICA → FWW 920×600 → wrapper CALL-only NUEVO
  `getLibroMayorDetalle` (`src/lib/actions/libro-mayor-detalle.ts`): `auth()` + zod +
  **`getLibroMayor` REUSADO intocado** (¡ya existía en `reportes/libro-mayor.ts` — el prompt
  suponía crearlo!) + cap display 500 con `truncado/totalLineas` honestos + docs de origen batch +
  `getAuditLog("CuentaContable", id)`. Display modelado en `/reportes/libro-mayor` (ARS-only v1):
  filtro de fechas interno (default 1º del mes→hoy), saldo inicial, saldo acumulado, Totales, link
  "Abrir en Libro Mayor →". Sección **Historial** (Q&A 7) colapsable — **empty-state honesto**
  (ningún writer usa `tabla:"CuentaContable"`; no hay CRUD de cuenta).
- **Divergencia de signo (documentada, NO corregida):** `getLibroMayor` signa por CATEGORÍA
  (`saldoPorCategoria`, ignora regularizadoras); el balance signa por NATURALEZA efectiva. Para
  regularizadoras la columna Saldo (balance) y el saldoFinal de la FWW pueden divergir de signo —
  divergencia PRE-existente del motor, trabada por assert explícito en el test de paridad
  (corregirla = tocar `reportes/shared.ts`, fuera del alcance; candidata a follow-up del dueño).
  Ídem el roll-up: suma cada hijo EN SU PROPIA naturaleza (regularizadora entra positiva) — la UI
  espeja tal cual.

## 6) Exports auditados (2 nuevos, patrón A fin-cxc)

| Recurso | Action | Columnas | Gate |
|---|---|---|---|
| `contabilidad-asientos` | `exportarAsientos` (`asientos-export.ts`) | las 9 OD-07 exactas | `requireSessionUser()` (sin clave propia — semántica actual de la página; decisión del plan) |
| `contabilidad-plan-de-cuentas` | `exportarPlanDeCuentas` (`plan-cuentas-export.ts`) | Código/Nombre/Tipo/Naturaleza/Categoría/Nivel/Padre/Estado/Saldo | ídem |

Ambos: re-lectura server-side de la MISMA proyección de la page → CSV/XLSX → **`auditarExportacion`
ANTES de entregar (falla ⇒ propaga, sin archivo)**. **Hallazgo del QA visual (corregido):** la URL
sin `?periodo=` aplica el período default server-side en la page pero el export salía sin filtro →
`resolverPeriodoExport` ahora resuelve el MISMO default (`periodoDefaultId`, mismo criterio que la
presentación) — trabado por test. QA: eventos EXPORTACION verificados en el AuditLog con
página/filtros (`periodoId` poblado)/columnas/nFilas.

## 7) Permisos — claves EXISTENTES, reflejo FE (cero regresión)

- Las 4 claves `ASIENTOS_*` existían en el catálogo pero **no estaban wired a nada**; el BE real
  es `requireAdmin()` (anular/mover/cambiarFecha/autoCorregir) y `auth()` (crear/contabilizar) —
  **sin cambios**. Este PR agrega SÓLO el reflejo FE: `ASIENTOS_ANULAR` en [Anular] (record:
  `PermissionGate variant="button"`; worklist: item disabled+hint) y `ASIENTOS_MOVER` en los
  accesos a mover-periodo (header de la worklist + Más acciones del record).
- Semántica: RBAC OFF ⇒ `permisos===undefined` ⇒ `useHasPermission` devuelve `true` (cero cambio
  visible — las claves NO están en `USER_BASE_CLAVES`); RBAC ON sin clave ⇒ **deshabilitado con
  tooltip, layout estable** (la spec decía "hidden"; el patrón canónico del repo es
  disabled-con-hint — el requisito sustantivo, botón inutilizable + BE niega, se cumple).
- Claves de la spec inexistentes (`manual_asiento`, `reverse_asiento`, `reopen_periodo`,
  `edit_cuenta_usada`) → comportamiento actual; **ninguna clave inventada**.
- Saldo/Libro Mayor: **decisión del dueño** — semántica actual (sesión autenticada, como
  cuentas/balance hoy); gating de reportes llega en PR-032.

## 8) Omitido / diferido (consume-or-omit)

1. **Cuenta CRUD** (crear/editar/inactivar, mapeo contable UI, import Excel, versionado, cambios
   estructurales) — el plan ULTRA es catálogo/seed; READ-ONLY acá.
2. **Reversar** como action nueva (caso b) — follow-up PR (decisión del dueño).
3. Reapertura de período con doble aprobación/SLA; cambios de cierre — `periodos/` intacto.
4. PDF con firma/hash (sin infra → CSV/XLSX); obligatoriedad de CC por cuenta (campo inexistente);
   scheduling de ajuste cambial (motor existe, sin UI nueva).
5. Hover usuario/CC/total-USD de la worklist; estado "Reverso"; multi-select de cuenta en el filtro.
6. CONT-03/04 (DRE/Balance + gating) — PR-032.

## 9) Archivos

**Nuevos (14 + 6 tests):** `asientos/{asientos-presentacion.ts, asientos-columns.tsx,
asientos-worklist.tsx, asiento-detalle-work-window.tsx, periodo-cuenta-filters.tsx,
asientos-export-button.tsx}` · `asientos/[id]/asiento-record-actions.tsx` ·
`cuentas/{cuentas-arbol-presentacion.ts, cuenta-libro-mayor-window.tsx, cuentas-export-button.tsx}`
· `src/lib/services/{asientos-worklist.ts, plan-cuentas-arbol.ts}` ·
`src/lib/actions/{asientos-export.ts, plan-cuentas-export.ts, libro-mayor-detalle.ts}` ·
`test/{asientos-worklist, asientos-export, plan-cuentas-arbol, plan-cuentas-export,
libro-mayor-detalle, libro-mayor-balance-parity}.test.ts`.

**Modificados (4):** `asientos/page.tsx` (tabla→worklist) · `asientos/[id]/page.tsx` (header
adaptativo + action bar + fetches display aditivos) · `cuentas/page.tsx` (proyección + export
button) · `cuentas/cuentas-tree-table.tsx` (evolución 5→7 columnas + búsqueda/niveles + click
analítica). **Legados conservados NO importados** (rollback): `asientos-table.tsx`,
`asientos-filters.tsx`, `asiento-detalle-sheet.tsx`.

**Prohibidos intocados:** `prisma/schema.prisma`, migrations, auth/JWT, catálogo/resolver/seed de
permisos (cero claves nuevas), `asiento-automatico.ts`, actions de `asientos.ts`,
`cuenta-registry`/`orden-eecc`/`cuenta-auto`/`plan-de-cuentas.data`, `balance-sumas-saldos.ts`,
`reportes/libro-mayor.ts`, `bi-drill-down.ts`, `periodos/`+cierre, `mover-periodo/`,
`nuevo/asiento-form.tsx`, `enterprise-data-grid.tsx`, nav (`nav-model.ts` ya apuntaba — cero cambio).
**Refs simbólicas ULTRA:** cero literales de código de cuenta en lógica nueva (la UI sólo muestra
datos del DB; grep de literales en los archivos nuevos: sólo display).

## 10) Validaciones (resultados)

- `pnpm prisma generate` ✅ · `pnpm typecheck` ✅ 0 errores · `pnpm build` ✅ (rutas contabilidad ƒ)
  · `pnpm biome:ci` ✅ exit 0 · `pnpm test` ✅ **174 archivos / 1331 tests** (incl. 6 suites nuevas
  = 48 tests; paridad Libro Mayor×Balance sobre Testcontainers con seed prisma directo — motor no
  invocado).
- Lizard (gate Codacy): **0 warnings CCN>8** en los archivos nuevos (helpers nombrados; 2 funciones
  refactorizadas de CCN 10→≤8 extrayendo `resolverFiltrosExport`/`serializarDetalle`).
- **`db:validar-asientos` + `db:validar-stock`: ✅ ANTES y DESPUÉS del QA**, contra Postgres 18
  descartable local (puerto 55432; `DATABASE_URL` default apunta a Railway/prod = STOP — nunca
  tocado). Invariantes A1-A5 verdes con asiento creado→contabilizado→anulado vía la UI nueva.

## 11) QA visual (checklist D.17 — env local: Postgres descartable + migrate deploy + seed; admin/admin123)

- ✅ Worklist: 9 columnas OD-07 (pineadas Número/Origen/Estado), KPIs, 6 vistas como Links, filtro
  Período (default = período de hoy, creado 2026-07 vía el flujo `periodos` intacto) + Cuenta.
- ✅ Crear manual vía el form hospedado (2 líneas balanceadas, cuentas del plan ULTRA por combobox)
  → mismo asiento BORRADOR (#1); fila con las 9 columnas; doc origen `—`.
- ✅ Fila → **FWW de detalle** (sin sheet lateral): mismas líneas + Totales.
- ✅ Record: AdaptiveRecordHeader + action bar; **[Ver origen] deshabilitado** (manual);
  [Contabilizar] → Dialog verbatim → CONTABILIZADO (refresh automático); Más acciones → Mover de
  período; [Anular] → Dialog verbatim → ANULADO; vista Anulados lo muestra tachado.
- ✅ Export asientos CSV: 9 columnas exactas + evento EXPORTACION en AuditLog (con `periodoId`
  poblado tras el fix de paridad).
- ✅ Plan de cuentas: 7 columnas; roll-up ACTIVO=1.000,00 tras contabilizar (paridad balance);
  búsqueda "CAJA GENERAL" poda+auto-expande; candados en sintéticas; click analítica → **FWW Libro
  Mayor** con la línea del asiento, saldo acumulado 1.000,00 y Totales (paridad con la columna
  Saldo); historial (0) honesto; export XLSX 631 filas + evento auditado.
- RBAC ON sin clave: cubierto por la semántica de `useHasPermission`/`PermissionGate` (tests) — el
  entorno QA corre con RBAC OFF (estado de prod), donde se verificó CERO regresión visual.

## 12) Rollback

Revertir `asientos/page.tsx` + `asientos/[id]/page.tsx` + `cuentas/page.tsx` +
`cuentas-tree-table.tsx` a los componentes legados (conservados en árbol); los servicios/actions
nuevos quedan huérfanos inofensivos. O `git revert` del PR completo — cero cambio de schema/seed/nav.
