# IMPLEMENTATION_NOTES_PR023c — CX-06 · MemoriaCalculoWindow + Simular + Export memoria auditado ⛔

**PR:** `feat(comex): CX-06 memoria de cálculo (window + simular + export) read-only (PR-023c)`
**Branch:** `pr-023c-comex-despacho-memoria-window` (base limpia de `origin/main`; PR-023b `#361` + PR-023a `#360` +
PR-023-pre `#359` ya mergeados — sin stacking).
**Tipo:** record-migration (cost UI) · Onda 2 · criticidad MÁXIMA. Sub-PR **final** de PR-023, después de PR-023b.

## Qué hace

Cierra CX-06 abriendo la **memoria de cálculo auditable** del costo landed en la ficha del despacho, en 3 capas
read-only, **gate único `VER_COSTO_LANDED`**:

1. **MemoriaCalculoWindow** (FloatingWorkWindow) abierta desde un gatillo `[Ver memoria de cálculo]` dentro de la
   pestaña Costos (rama CRUZADO, ya gateada server-side en PR-023b). Muestra: badge de la **función real** del motor,
   **base usada**, TCs, tabla **por SKU** (código · producto · cantidad · **participación %** · base · capitalizables
   alocados · costo unit. landed · costo total), línea de **ajuste de redondeo** y fila **TOTAL** (100%).
2. **Simular** (botón en el footer): re-preview read-only sobre los datos actuales — **misma función real**, sin input
   editable, sin escenario, sin escritura.
3. **Export auditado** CSV/XLSX de la memoria (mirror de `exportarEmbarques` + `auditarExportacion`).

**DISPLAY-only · motor/schema/actions/permisos INTOCADOS · sin PDF (no hay infra) · sin worklist global · sin costo
gerencial.** Memoria y Simular consumen el existente `obtenerMemoriaDespacho` (que reejecuta el motor golden-protegido
`calcularCostoLandedDespacho` SIN escribir — CRIT-05 caso a, byte-estable BORRADOR↔CONTABILIZADO).

## Archivos

**Creados:**
- `src/lib/services/despacho-memoria-vista.ts` — proyección PURA `proyectarMemoria(memoria, nombres)` +
  `leerMemoriaDetalle(despachoId)` (read-only; consume `obtenerMemoriaDespacho` + lookup de nombres vía
  `db.producto.findMany`) + `buildMemoriaRows`/`memoriaExportColumns` (export). Helpers CC ≤ 8 (`baseDeItem`,
  `mapLinea`, `calcularAjusteRedondeo`, `nombresPorProducto`). `import type { CostoLandedResult }` es type-only (sin
  import runtime del motor).
- `src/lib/actions/comex-despacho-memoria.ts` — `verMemoriaAction`/`simularMemoriaAction` (`"use server"`): gatean
  `VER_COSTO_LANDED` **antes** de leer/proyectar y delegan en `leerMemoriaDetalle`. Simular === verMemoria
  (re-preview).
- `src/lib/actions/comex-despacho-memoria-export.ts` — `exportarMemoriaDespacho({despachoId, formato})`
  (`"use server"`): `requireSessionUser()` → gate `VER_COSTO_LANDED` (niega la acción entera sin permiso) →
  `leerMemoriaDetalle` → `buildMemoriaRows`/`memoriaExportColumns` → serializa CSV/XLSX → `auditarExportacion` **ANTES**
  de devolver → base64. Falla de auditoría propaga → sin archivo.
- `…/[despachoId]/_components/memoria-calculo-window.tsx` — client (FWW read-only): gatillo + cabecera + tabla +
  ajuste + total + footer (`<MemoriaSimular/>` + export CSV/XLSX). `descargarBase64` baja los bytes construidos por el
  servidor (sin DOM-scraping).
- `…/[despachoId]/_components/memoria-simular.tsx` — client: botón `[Simular]` → `simularMemoriaAction` → `onResult`.
- `test/comex-despacho-memoria-window.test.ts` — 22 tests (mock-based, sin Docker).
- este archivo.

**Modificados (aditivo — sólo wiring de la pestaña Costos):**
- `…/_components/costos/costos-tab-content.tsx` — prop `despachoId` a `CostosTabContent`; `CostosCruzado` monta
  `<MemoriaCalculoWindow despachoId estado={costos.estado} />`. Los otros 5 bloques quedan **iguales**.
- `…/_components/despacho-record.tsx` — 1 línea aditiva: `<CostosTabContent costos={costos} despachoId={vista.id} />`.
  Las otras 7 pestañas quedan **iguales**.

**NO tocados (prohibidos):** `prisma/schema.prisma`, migrations, auth/JWT/sesión, modelo/catálogo de permisos,
`services/comex.ts`, `services/despacho-parcial.ts` (`calcularCostoLandedDespacho`), `lib/actions/despachos.ts`,
actions de embarques/contenedores/vep, motores de asiento/stock/costo/rateio. **`despacho-memoria.ts` NO se tocó**
(consumido tal cual).

## Mapa dato → fuente (NADA se recomputa en la UI)

Todo valor MONETARIO es un campo del motor (`landed.*`, `porItem[].*`). `participación %` y `ajuste de redondeo` son
DERIVACIONES puras de display que reconcilian a los totales del motor.

| Campo | Fuente |
|---|---|
| Badge de función | `memoria.baseRateio` → "Rateo proporcional por FOB nacionalizado" / "…por cantidad (FOB total = 0)" |
| Base usada / TCs / estado | `memoria.baseRateio` · `tipoCambioEmbarque`/`tipoCambioDespacho` · `estado` |
| Por línea: código/nombre | `porItem[].productoId` ⨝ `db.producto` (fallback a `productoId`/`—`) |
| Por línea: cantidad | `porItem[].cantidad` |
| Por línea: participación % | **derivado**: `base_i / Σ base` (FOB: `costoFcUnitarioArs×cantidad`; CANTIDAD: `cantidad`) |
| Por línea: capitalizables alocado | `porItem[].capitalizablesItemArs` (motor; último ítem absorbe el residuo) |
| Por línea: costo unit./total landed | `porItem[].costoUnitarioLandedArs` (4dp) / `costoTotalArs` (2dp) |
| Valor a ratear / nacionalizado / total | `landed.{capitalizablesArs, nacionalizadoArs, costoTotalArs}` |
| Ajuste de redondeo | **derivado/anotación**: `capitalizablesArs − Σ round2(participación_i × capitalizablesArs)`; anexado como línea, NO como total extra (Σ `capitalizablesItemArs` == `capitalizablesArs`, motor ya reconcilia) |

**Estados:** CONTABILIZADO → memoria consolidada · BORRADOR → misma ventana, framing "Simulación (preview)"
(byte-estable) · LEGACY → honesto "sin memoria de rateio" · ANULADO → honesto read-only · costos abiertos (throw
"no tiene costo FC") → catch estrecho → "Cerrá los costos…" (cualquier otro error se RE-LANZA).

## Prueba: motor/actions/schema/permisos intocados (read-only)

- La memoria/simular/export sólo llegan al motor vía `obtenerMemoriaDespacho` (lectura que reejecuta el motor SIN
  escribir — golden PR-023-pre). NUNCA llaman `calcularCostoLandedDespacho` directo. `import type` del motor sólo.
- Export escribe **sólo** el evento append-only EXPORTACION (via `auditarExportacion` existente — G-07/CRIT-11).
- Prueba estructural: el diff toca la ruta `[despachoId]/*` (2 componentes nuevos + 2 wiring), 3 archivos nuevos en
  `src/lib/{services,actions}`, el test y este doc. Cero motor/action-existente/schema/migration/permiso.
- **Goldens verdes (motor byte-idéntico):** `comex-despacho-memoria.golden` **5/5**; `comex-despacho-costos-vista`
  (023b) **18/18**.

## Prueba: gate `VER_COSTO_LANDED` server-side + sin serialización sin permiso

- Trigger: `<MemoriaCalculoWindow>` sólo se monta dentro de `CostosCruzado`, que sólo existe cuando `costos !== null`
  (⇔ `verCosto === true` server-side en `page.tsx`). Sin permiso el botón ni se renderiza.
- Acciones (view/simular/export): gatean `hasPermission(PERMISOS.VER_COSTO_LANDED)` **antes** de leer/proyectar.
  Sin permiso → view/simular `{ok:false, reason:"SIN_PERMISO"}`, export `{ok:false, error}`; `obtenerMemoriaDespacho`
  **no** se invoca → ningún valor (FOB/rateio/capitalizables/costo) se computa ni serializa. Tests lo prueban.

## Prueba: Simular no persiste · Export auditado antes del archivo · sin leak

- `simularMemoriaAction` === `verMemoriaAction` (re-preview). Test: `sim ≡ ver`; ninguna mutación de DB invocada
  (`create/update/$transaction` no llamados).
- Export: `auditarExportacion({recurso:"comex-despacho-memoria", …})` se `await`-ea ANTES del `return base64`. Test:
  auditoría llamada 1× con el recurso correcto y base64 devuelto; **falla de auditoría → propaga, sin base64**.
- Export sólo columnas de la memoria (sin `debe`/líneas de asiento). Test: CSV y `columnas` no contienen ledger crudo.
- Export corre en node (sin DOM) → los tests happy-path (CSV/XLSX) son la prueba de que no scrapea el DOM.

## Validación (resultados)

- `pnpm prisma generate` → OK · `pnpm typecheck` → OK (0 errores) · `pnpm biome:ci` → exit 0 · `pnpm build` → OK.
- `pnpm test` → verde. Nuevo `comex-despacho-memoria-window` **22/22**; golden CRIT-05 **5/5**; costos-vista 023b
  **18/18**.
- **`pnpm db:validar-stock` / `pnpm db:validar-asientos` — NO ejecutados** (default `DATABASE_URL` = PRODUCCIÓN/
  Railway → STOP). PR read-only; su cobertura de invariantes está garantizada por `validar-invariantes-comex.test.ts`
  (Testcontainers) + la prueba estructural "motor intocado".

## QA manual (env local seguro — Postgres descartable; NUNCA prod/Railway; admin/admin123)

Ficha → Costos → `[Ver memoria de cálculo]`: CONTABILIZADO (memoria consolidada), BORRADOR (preview), LEGACY/ANULADO
honestos, costos abiertos → mensaje. Simular no persiste. Export CSV/XLSX + evento de auditoría. Sin
`VER_COSTO_LANDED`: botón ausente + acción negada, nada sensible en HTML/Network. Cero mutaciones. Prod/Railway
intocado.

## Boundary / non-goals

Sin PDF (no infra), sin fórmulas/hash forense (override del dueño), sin worklist global `/comex/costos`, sin costo
gerencial, sin claves `ver_memoria_costo`/`export_memoria_costo` (override → gate único `VER_COSTO_LANDED`), sin
reabertura/recontabilización (approvals engine + schema).

## Rollback

Quitar los 2 componentes + el gatillo en `CostosCruzado` + el `despachoId` en el dispatcher + los 3 archivos de
`src/lib/{services,actions}` + el test + este doc. Sin migration/seed/engine → rollback trivial.
