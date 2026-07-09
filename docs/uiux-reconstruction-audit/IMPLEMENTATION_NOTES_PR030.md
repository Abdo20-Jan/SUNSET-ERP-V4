# IMPLEMENTATION NOTES — PR-030 · CRM-01 (Leads + Oportunidades · worklists + records + toggle Lista|Tablero)

- **Fecha:** 2026-07-09 · **Branch:** `pr-030-crm01-rebuild` (base limpia de `origin/main` @ `0b744d39`, sin stacking)
- **Tipo:** worklist-migration + record-migration · **UI-only** — DISPLAY + hosting de actions existentes con payloads byte-idénticos.
- **Ficha canon:** `pages/CRM-01_CRM_Leads_Oportunidades.md` (Obsidian) + PAGE-STD-01/02 + G-04.

## 1. Qué se construyó (canon vs shipped)

| Canon CRM-01 | Estado |
|---|---|
| Worklist densa de Leads (7 campos mínimos) | ✅ EnterpriseDataGrid, 13 columnas: Nombre·Empresa·Estado·Score·Fuente·**Próxima acción**·**Último contacto**·**Seguimiento**·CUIT·Email·Owner·Cliente·Creado |
| Worklist densa de Oportunidades | ✅ 11 columnas: N°·Título·Lead/Cliente·Monto·**Prob %**·**Ponderado**·Stage·Estado·**Próxima acción**·Owner·Cierre est. |
| Toggle **[Vista: Lista \| Tablero]** in-page | ✅ `?vista=tablero` server-side (canon fin-cxc de presets URL); Tablero = `KanbanBoard` REUTILIZADO in-place |
| Records PAGE-STD-02 con tabs | ✅ Resumen / Actividades / Contactos / Historial en ambos; AdaptiveRecordHeader + RecordActionBar + RecordTabs |
| Edición en FWW (retiro del full-page) | ✅ `lead-edit-window` + `oportunidad-edit-window` (props aditivas PR-018/019); `/crm/leads/[id]/editar` → redirect al record |
| [Registrar actividad] en FWW | ✅ `crm/_components/registrar-actividad-window.tsx` — **1er consumidor UI** de `crearActividadAction` |
| Alertas derivadas (sin follow-up / sin próxima acción) | ✅ derivadas de `Actividad` (ver §2); badge en columna + vistas/presets dedicados |
| [Exportar pipeline] auditado | ✅ `crm-pipeline-export.ts` (+ export de leads por convención de la serie) — `auditarExportacion` ANTES de entregar el archivo |
| Bulk actions preservadas | ✅ **1er uso real de la infra `bulkActions` del grid en el repo** (antes solo placeholders disabled): leads = cambiar estado; oportunidades = asignar owner. Dialog de confirmación canónico reemplaza `window.confirm/alert` |
| Conversiones (lead→cliente) | ✅ `ConvertirClienteButton` hospedado VERBATIM (mismo cliente creado — verificado en QA) |

## 2. Veredictos del model-backing check (preflight A5)

| Pregunta | Veredicto | Consecuencia |
|---|---|---|
| ¿`proximaAccion` en Lead/Oportunidad? | **NO existe** | DERIVADA: próxima acción = `Actividad` pendiente (`completada=false`) con menor `fechaProgramada` (sin fecha → «Pendiente sin fecha»); último contacto = `completada=true` con mayor `fechaCompletada`. Leads: query batch `cargarActividadesSeguimiento` (services) + espejo puro `derivarSeguimiento`. Oportunidades: `listarProximasAccionesPendientes` (`crm-proxima-accion.ts`). |
| ¿`crearLeadAction` bloquea duplicados CUIT/email? | **NO** (dedup solo opcional en import CSV) | **OMITIDO** — bloqueo de duplicados = cambio de action → follow-up. |
| ¿`cerrarPerdidaAction` recibe motivo? | **NO** — firma `(id)`; sin campo en schema | **OMITIDO** — botones hospedados verbatim; motivo de pérdida = follow-up (action+schema). |
| ¿Probabilidad por etapa? | `Oportunidad.probabilidad Int @default(50)` **ya es campo persistido**; la "etapa" es la tabla `PipelineStage` (no enum) | Ponderado = `monto × probabilidad/100` **display-only** (decimal, 2 dígitos, `calcularValorPonderado`). NO se usó el mapeo fijo etapa→% de la ficha: el dato real es el campo. Nada persistido. |

**Regla sin follow-up (documentada en `lead-seguimiento.ts`):** lead en estado activo (NUEVO/CONTACTADO/CALIFICADO) ∧ sin actividades pendientes ∧ sin contacto completado en los últimos **7 días**. Predicado íntegro **en el banco** (`listarLeadsSinFollowUp`, count con el mismo where → total/paginación honestos) + espejo puro `esSinFollowUp` para la columna (paridad SQL↔puro trabada por tests). La regla 14d de gestor fue **OMITIDA**: sin clave de permiso CRM no hay rol gestor distinguible — no se finge.

## 3. Prueba de reuso del kanban (toggle Tablero)

- `kanban-board.tsx` y `pipeline/_helpers.ts`: **cero diff** (`git diff` vacío sobre ambos). Drag HTML5 nativo, optimista+rollback, `moverStageAction(cardId, stageId)` — todo intacto.
- `renderTablero` en `oportunidades/page.tsx` repite el call-shape EXACTO del viejo `pipeline/page.tsx`: `listarStages()` + `listarOportunidades({estado: ABIERTA})` → `buildKanbanCards(ops, moneda, tc)` → `<KanbanBoard stages cards/>`. Import in-place (`./pipeline/_components/kanban-board`), sin mover archivos → `test/oportunidades-monto-label.test.ts` sigue verde **sin tocarlo**.
- QA real: drag de O-2026-0001 movió el stage en el banco (orden 1 → 3 "Propuesta") con estado ABIERTA preservado; drop en stage ganada/perdida cierra y desaparece del board (solo ABIERTA cargada) — igual que el pipeline viejo.

## 4. Evidencia de payload byte-idéntico por action hospedada

| Action | Llamada nueva | Igual al legado |
|---|---|---|
| `bulkUpdateLeadsEstadoAction` | `{ids: rows.map(r=>r.id), estado}` | ✓ (tabla bulk vieja) |
| `bulkAssignOportunidadesOwnerAction` | `{ids, ownerId}` | ✓ |
| `crearLeadAction`/`editarLeadAction` | vía `buildLeadInput` **INTOCADO** | ✓ |
| `crearOportunidadAction`/`editarOportunidadAction` | vía `buildOportunidadInput` **INTOCADO** (edit = 1er consumidor UI) | ✓ |
| `moverStageAction(id, stageId)` | solo dentro de kanban/mover-stage-select intocados | ✓ |
| `cerrarGanadaAction(id)`/`cerrarPerdidaAction(id)` | botones verbatim, sin motivo fabricado | ✓ |
| `convertirLeadEnClienteAction(id)`/`eliminarLeadAction(id)` | botones verbatim en RecordActionBar | ✓ |
| `crearActividadAction({tipo, contenido, fechaProgramada?, …target})` | 1er consumidor UI (schema-conform; `fechaProgramada` como `Date` = tipo de `z.input` de `z.coerce.date()`) | n/a (sin UI previa) |
| `completarActividadAction(id)` | `CompletarButton` importado verbatim | ✓ |
| `crear/editar/marcarPrincipal/eliminarContactoAction` | 1er consumidor UI en tab Contactos del lead | n/a |
| `resumirLeadAction`/`recalcularScoringLeadAction` | `AiSection` importada VERBATIM en tab Resumen | ✓ |

**Cero ediciones** en `leads.ts`, `oportunidades.ts`, `actividades.ts`, `contactos.ts`, `crm-ai.ts`, `import-leads.ts`, `pipeline.ts`, `prisma/schema.prisma`, permisos/auth. Props aditivas en forms: `embedded?/onCancel?/onSuccess?/onDirtyChange?` (+ 3er parámetro opcional en `useLeadFormSubmit`); `/nuevo` y `/nueva` no pasan nada → flujo idéntico.

## 5. Ownership (decisión del dueño, 2026-07-09)

**Owner-scoping real: DEFERIDO** (STOP-gate D10 resuelto en sesión). Las listas siguen mostrando TODO a cualquier usuario con CRM habilitado, como hoy. Interim: vista/preset **«Mis registros» / «Míos»** (`?owner=me` / `?vista=mios`) que resuelve `filtros.ownerId = session.user.id` server-side — parámetro que las actions **ya aceptaban**. **Es conveniencia de presentación, NO frontera de seguridad** (cualquier usuario la quita editando la URL) — comentado en el código de ambas pages. Scoping real (queries + criterio gestor/vendedor + posible clave CRM) = follow-up dedicado sobre las actions.

## 6. Mapa de redirects y navegación

| Ruta vieja | Ahora |
|---|---|
| `/crm/leads/[id]/editar` | `redirect(/crm/leads/[id])` — edición vive en FWW del record (precedente PR-019 / `ventas/[id]/entregas`) |
| `/crm/oportunidades/pipeline` | `redirect(/crm/oportunidades?vista=tablero)` preservando `moneda`; subárbol `_helpers`/`_components` queda in-place (lo importa el nuevo host) |
| Nav item «Pipeline» (`nav-model.ts`) | href → `/crm/oportunidades?vista=tablero` (link directo, sin hop). Degradación cosmética aceptada: `isHrefActive` compara pathname → el ítem no se auto-resalta. |
| NavTile «Pipeline kanban» (`/crm`) | mismo href nuevo |

Round-trip del toggle: `moneda` se preserva en ambas direcciones; `estado/filtro/owner` no viajan al tablero (no los consume — solo ABIERTA, paridad con el pipeline viejo), por lo que volver a Lista restablece «Todas». Comportamiento aceptado y documentado.

## 7. Archivos

**Creados (25):** shared `crm/_components/registrar-actividad-window.tsx` · leads: `lead-seguimiento.ts` (services), `leads-{presentacion,columns,worklist,export-button}`, `crm-leads-export.ts`, `[id]/_components/{lead-edit-window,lead-resumen-tab,lead-actividades-tab,lead-contactos-tab,contacto-window}` · oportunidades: `crm-proxima-accion.ts` (services), `oportunidades-{presentacion,columns,worklist,bulk-assign,export-button}`, `vista-toggle`, `crm-pipeline-export.ts`, `[id]/_components/{oportunidad-edit-window,oportunidad-resumen-tab,oportunidad-actividades-tab,oportunidad-contactos-tab}` · tests: `test/{leads-presentacion,lead-seguimiento,oportunidades-presentacion,crm-oportunidades-export}.test.ts` (50 tests).

**Modificados (13):** `crm/leads/{page,[id]/page,[id]/editar/page}.tsx`, `leads-filter-bar.tsx` (prop aditiva `vista`), `lead-form.tsx` + `use-lead-form-submit.ts` (props aditivas), `crm/oportunidades/{page,[id]/page,pipeline/page}.tsx`, `oportunidad-form.tsx` (props aditivas), `crm/page.tsx` (href tile), `nav-model.ts` (href), `status-badge.tsx` (tonos aditivos CONTACTADO/CALIFICADO/DESCALIFICADO/CONVERTIDO).

**Eliminados (3):** `leads-table-bulk.tsx`, `oportunidades-table.tsx`, `oportunidades-table-bulk.tsx` (grep previo: solo las pages los importaban; el tipo `OportunidadRow` migró a la presentacion como `Awaited<ReturnType<…>>`).

## 8. Validación (2026-07-09, DB local descartable — nunca Railway/prod)

```
pnpm prisma generate  ✓
pnpm typecheck        ✓ (0 errores)
pnpm build            ✓
pnpm biome:ci         ✓ (tras biome:format; 48 warnings pre-existentes del repo)
pnpm test             ✓ 181 files / 1396 tests (incluye los 50 nuevos + oportunidades-monto-label intocado)
pnpm db:validar-asientos ✓ (CRM no toca el ledger — probado)
```

Lizard local: 0 warnings en `.ts`; `LeadFields@10` en `.tsx` es artefacto conocido del parser local con JSX (precedente PR-028: el Codacy real es menos estricto en `.tsx`).

## 9. QA manual (Postgres descartable 55432/sunset_qa + fixtures CRM; admin/admin123; browser real)

- **Leads:** grid denso 13 col ✓ · vistas Todos/Míos(4)/Sin follow-up(solo Jorge Díaz — paridad SQL↔badge) ✓ · filtros GET `q/estado/fuente` server-side ✓ · **bulk estado in-grid**: selección → «Acción en masa» → 5 items → Dialog confirmación → estado actualizado + selección limpia ✓ · row→record ✓ · **Editar en FWW** persiste y permanece en el record ✓ · `/editar` redirige ✓ · **Convertir** creó el MISMO cliente (Gomería Paz) y marcó CONVERTIDO ✓ · Eliminar ✓ · AiSection renderiza ✓ · import/nuevo intactos ✓ · derivaciones Próxima acción/Último contacto/«Pendiente sin fecha» correctas contra fixtures ✓.
- **Oportunidades:** 11 col con Prob% y Ponderado (12.500×25%=3.125 ✓; recalculado a 5.000 tras editar prob→40 ✓) · 7 presets + «Sin próxima acción» (solo O-0002) ✓ · **toggle Lista|Tablero misma página** ✓ · `/pipeline` redirige preservando moneda ✓ · **drag en Tablero movió stage en el banco** (misma action) ✓ · fechadas fuera del board ✓ · cerrar ganada → GANADA + botones desaparecen ✓ · **bulk asignar owner** (dialog custom + selección limpia) ✓ · summary de selección con suma ponderada ✓ · MonedaToggle ARS/USD ✓.
- **Records:** registrar actividad en FWW → aparece en timeline (lead y oportunidad) ✓ · completar ✓ · contactos CRUD (crear «Sofía QA», principal, badge) ✓ · tab Contactos de oportunidad muestra los del vínculo con leyenda ✓ · **merge del vínculo convertido**: editar O-0004 (lead Carlos convertido) mantiene «Gomería Paz» seleccionado — sin limpieza silenciosa ✓ · dirty-gate (Escape con cambios → dialog Descartar) ✓ · Historial «Sin historial de cambios.» honesto ✓ · [Crear presupuesto] AUSENTE ✓ · motivo de pérdida AUSENTE (verbatim) ✓.
- **Export:** CSV descarga respetando filtros URL (`estado=ABIERTA` → solo O-0002), 15 columnas native-first, ponderado correcto; **evento EXPORTACION en AuditLog** con `{pagina: crm-oportunidades, filtros:{tc,estado,filtro,moneda}, nFilas, formato}` y visible en `/sistema/auditoria` ✓.
- Cero errores de console en toda la sesión ✓ · `tsconfig.json` no ensuciado por `next dev` ✓.

## 10. Omitidos / follow-ups (consume-or-omit — nada fingido)

1. **Motivo obligatorio en Perdido** — requiere cambiar `cerrarPerdidaAction` + schema → follow-up.
2. **Owner-scoping real** — deferido por decisión del dueño (§5) → follow-up sobre actions (+ posible clave CRM).
3. **Bloqueo de lead duplicado CUIT/email** — no existe en `crearLeadAction` → follow-up.
4. **[Crear presupuesto] desde ganada** — Presupuesto es greenfield (COM-04/PR-033) → botón ausente.
5. **Alerta 14d de gestor** — sin rol distinguible sin claves CRM → derivación 7d única documentada.
6. **AuditLog CRM** — ninguna action CRM escribe auditoría → Historial nace vacío honesto; instrumentar `registrarAuditoria` en las actions = follow-up.
7. Deuda menor heredada de la serie (FIN-01/COMP-01): sort de Monto/Ponderado usa magnitud nativa (multimoneda puede divergir del display convertido); facets/quickSearch del grid son presentation-only y no viajan al export (disclaimer en el header de la action, paridad fin-cxc).

## 11. Rollback

`git revert` del commit único restaura tablas legadas, barra bulk externa, `/editar` full-page y `/pipeline` como página — UI-only, sin estado persistido, sin migraciones. Los componentes del kanban jamás se movieron.
