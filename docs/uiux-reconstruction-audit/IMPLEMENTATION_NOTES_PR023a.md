# IMPLEMENTATION_NOTES_PR023a — CX-05 · Despacho Record (PAGE-STD-02)

**PR:** `feat(ui): CX-05 despacho record — PAGE-STD-02 (PR-023a)`
**Branch:** `pr-023a-despacho-record` (base limpa de `origin/main`; PR-023-pre `#359` ya mergeado).
**Tipo:** record-migration · Onda 2 · criticidad MÁXIMA. Sub-PR de PR-023, después del gate golden PR-023-pre (CRIT-05).

## Qué hace

Stand-up de la **ficha del Despacho** en `comex/embarques/[id]/despachos/[despachoId]` (no existía):
`AdaptiveRecordHeader` (3 líneas) + 8 pestañas canónicas (Resumen/Items/Tributos/Facturas/Costos/Asiento/
Documentos/Auditoría) que **DISPLAY** el DTO `DespachoDetalle` y **HOST** las acciones existentes
(`contabilizar/anular/eliminar`). Espeja PR-021 (embarque record). La fila de la lista de despachos ahora
enlaza a la ficha (`EntityLink`).

**UI-only · motor intocado · payloads byte-idénticos.** Sin schema, sin migration, sin nueva clave de permiso,
sin tocar el motor de rateio. El masking de costo/tributos ocurre **server-side**.

## Archivos

**Creados:**
- `…/despachos/[despachoId]/page.tsx` — server component: `obtenerDespachoPorId(despachoId)` → `notFound()` →
  `puedeVerCostoLanded()` → `proyectarDespacho(detalle, verCosto)` → `resolveActiveTab(sp.tab, DESPACHO_TABS, "resumen")`
  → `<DespachoRecord/>`.
- `…/despachos/[despachoId]/_components/despacho-record.tsx` — server component: `RecordLayout` + header +
  `RecordActionBar` (hospeda `<DespachoActions/>`) + `RecordTabs` + contenido de las 8 pestañas (cada pestaña es un
  subcomponente chico; el dispatcher usa un mapa `Record<string, ReactNode>` lazy → complejidad ≈ 2, sin switch de 8).
- `…/despachos/[despachoId]/_components/despacho-vista.ts` — proyección de masking server-side `proyectarDespacho`
  (espejo de `embarque-vista.ts`). *Archivo extra al listado de 4 del enunciado: el mandato de "omitir server-side"
  exige un punto de proyección; aislarlo mantiene page/record bajo el límite de complejidad y espeja PR-021.*
- `…/despachos/[despachoId]/loading.tsx` — `PageSkeleton`.
- `docs/uiux-reconstruction-audit/IMPLEMENTATION_NOTES_PR023a.md` — este archivo.

**Modificado (aditivo):**
- `…/despachos/page.tsx` — 2 cambios aditivos: `import { EntityLink }` + envolver `{d.codigo}` de la fila en
  `<EntityLink href={`/comex/embarques/${id}/despachos/${d.id}`}/>`. Lista, matriz de creación, editor de tributos
  inline y el `DespachoActions` inline quedan **iguales**.

**NO tocados (prohibidos):** `prisma/schema.prisma`, migrations, auth/JWT/sesión, modelo de permisos, y el motor
Comex + actions: `services/comex.ts`, `services/despacho-parcial.ts` (`calcularCostoLandedDespacho` — DO-NOT-TOUCH),
`lib/actions/{despachos,despacho-cruzado-costos,embarques,…}.ts` (LLAMADOS/HOSPEDADOS, nunca editados).

## Mapa pestaña → campo de `DespachoDetalle`

DTO (`despachos.ts:52-81`; `obtenerDespachoPorId` `:108-186` lee campos STORED, **no llama al motor**).

| Pestaña | Campos | Masking |
|---|---|---|
| **Resumen** | estado · embarque (EntityLink) · fecha · Nº OM · itemsCount · facturasCount · asiento · notas | bloque "Costo (landed)" (`landedItemsTotal`, `tributosCapitalizables`, `tributosCashOut`) **omitido server-side** sin permiso |
| **Items** | `items[]`: # · `productoCodigo`+`productoNombre` · `cantidad` · `cantidadEmbarque` · **Costo FC unit.** | columna costo sólo si `financiero !== null` |
| **Tributos** | `tipoCambio` + `die/tasaEstadistica/arancelSim/iva/ivaAdicional/iibb/ganancias` | toda la grilla gated; sin permiso → aviso "valores ocultos" |
| **Facturas** | `facturas[]`: proveedor · número · `momento` · **Total ARS** | columna total sólo si `financiero !== null` |
| **Costos** | resumen gated: costo landed ítems + tributos capitalizables + cash-out (no costo) + nota "detalle: PR-023b/c" | gated; sin permiso → aviso |
| **Asiento** | `asiento` → link a `/contabilidad/asientos/{id}`; si null → "Sin asiento" | — |
| **Documentos** | empty-state (sin campo en el DTO; CX-07 diferido) | — |
| **Auditoría** | `getAuditLog("Despacho", id)` → `AuditTrail` | — |

**Header (3 líneas):** L1 `Despacho {codigo}` + `StatusBadge`. L2 embarque `EntityLink` + `valor` = **costo landed
total gated** (Σ `costoUnitario×cantidad`; "— costo oculto" sin permiso, espeja el FOB de PR-021). L3 meta: Fecha · Nº
OM · Asiento.

## Omitido + por qué

- **`tipo` total/parcial** — no está en el DTO.
- **"última act. por usuario" / `updatedAt`** — el DTO del despacho no lo trae (a diferencia del embarque) → sin la
  fila "Última actualización" del header.
- **Estado Provisorio** — no existe valor en el enum `DespachoEstado` → no se inventa badge (necesitaría schema).
- **Container por ítem** — `items[]` no trae contenedor (la matriz cruzada vive en la list page).
- **Landed estimado vs final, split contable/gerencial** — el DTO sólo trae `costoUnitario` crudo + tributos crudos;
  la memoria computada vive en `obtenerMemoriaDespacho` → **PR-023c**. Acá: resumen mínimo de valores STORED.
- **Worklist rica de Costos (6 secciones)** → **PR-023b**.
- **MemoriaCalculoWindow / Simular / export de memoria** → **PR-023c** (sin botón de memoria en 023a).
- **Reapertura/recontabilización (versionado + doble aprobación + SLA + asiento reverso)** → motor de aprobaciones +
  schema.
- **Historial de reversión de asiento; upload de documentos; instrumentación de auditoría de las actions** → fuera
  de alcance.

## Prueba: payload byte-idéntico de las acciones hospedadas

`DespachoActions` se reusa **verbatim** (mismo archivo `…/despachos/_components/despacho-actions.tsx`), con las
mismas props `{despachoId, estado, codigo}` que pasa la list page hoy. Internamente llama:
`contabilizarDespachoAction(despachoId)` / `anularDespachoAction(despachoId)` / `eliminarDespachoAction(despachoId)` —
**bare `despachoId: string`**, sin reshaping, sin FormData, sin objeto nuevo. La ficha no crea ni envuelve ninguna
acción. El estado-gating (ANULADO → "—"; BORRADOR → Contabilizar+Eliminar; CONTABILIZADO → Anular) ya está en el
componente → contabilizado/anulado ⇒ read-only se cumple sin código nuevo.

## Prueba: motor intocado / sin recálculo

- La ficha llama **sólo** `obtenerDespachoPorId` (lectura) y `getAuditLog` — nunca `calcularCostoLandedDespacho`,
  `services/comex.ts` ni `services/despacho-parcial.ts`.
- `proyectarDespacho` es **puro DISPLAY**: copia campos STORED y suma para presentación (`Σ costoUnitario×cantidad`,
  subtotales de tributos). No reconstruye el costo landed (no aplica FOB+tributos vía motor) — multiplica un costo
  unitario **ya almacenado** por la cantidad, como el `fobTotal` del header del embarque. CRIT-04/05 intactos.
- CRIT-06: IVA/IVA adic./IIBB/Ganancias se rotulan explícitamente como **cash-out / crédito (no costo)** en Tributos
  y Costos.

## Prueba: masking server-side (G-06/G-10)

`proyectarDespacho(detalle, verCosto)` con `verCosto = await puedeVerCostoLanded()` (= `hasPermission(VER_COSTO_LANDED)`,
única clave de costo Comex existente — `permisos-catalog.ts:57`; el `ver_costo_comex` del enunciado es misnomer). Cuando
`!verCosto` devuelve `financiero: null` y la `DespachoVista` **no contiene** `costoUnitario`, ni los 8 tributos +
`tipoCambio`, ni `totalArs` por factura → esos números **no se serializan al cliente**. El condicional en las pestañas
es sólo reflejo de UX. Operacionales (estado, ítems, cantidades, proveedor, momento, fechas) siguen visibles.

## Validación (resultados)

- `pnpm prisma generate` → OK.
- `pnpm typecheck` → OK (0 errores).
- `pnpm build` → OK; la ruta `/comex/embarques/[id]/despachos/[despachoId]` compila (ƒ dynamic).
- `pnpm biome:ci` → exit 0 (tras `pnpm biome:format`; sólo warnings preexistentes).
- `pnpm test` → **155 archivos / 1167 tests passed**. Incluye el golden CRIT-05
  (`comex-despacho-memoria.golden` 5/5), `golden-costo-landed-despacho` (2/2),
  `validar-invariantes-comex` (9/9) y todas las suites despacho/cruzado/VEP (57/57).
- **`pnpm db:validar-stock` / `pnpm db:validar-asientos` — NO ejecutados localmente a propósito.** Esos scripts
  corren contra `DATABASE_URL`, que por defecto apunta a **PRODUCCIÓN (Railway)** → condición de STOP ("Production DB
  would be needed"). Su cobertura de invariantes (stock + asientos coherentes) está garantizada por
  `validar-invariantes-comex.test.ts` (verde, Postgres efímero vía Testcontainers) **y** por la prueba estructural:
  `git diff --name-only` no toca ningún archivo de motor/stock/asiento/action/schema (UI-only). En CI corren con DB
  segura.

**Prueba estructural "motor intocado":** el diff sólo contiene la nueva ruta `[despachoId]/*`, este doc, y 2 líneas
aditivas en `…/despachos/page.tsx`. Cero archivos de `services/comex.ts`, `services/despacho-parcial.ts`,
`lib/actions/*`, `prisma/schema.prisma`, migrations, auth o permisos.

## QA manual (env local seguro — Postgres descartable; NUNCA prod; admin/admin123)

- Lista de despachos → la fila abre la ficha (header + 8 pestañas); lista/creación/editor de tributos siguen igual.
- Resumen/Items/Tributos/Facturas renderizan de `DespachoDetalle`; Asiento enlaza cuando CONTABILIZADO.
- Contabilizar/anular/eliminar desde la ficha = idéntico a desde la lista (mismos diálogos, mismo resultado).
- Usuario sin `VER_COSTO_LANDED`: no ve costo unitario / tributos / totales de factura (omitidos server-side); campos
  operacionales visibles. ANULADO/CONTABILIZADO read-only.
- Auditoría muestra "Sin historial" (esperado — actions no instrumentadas).

## Rollback

Eliminar la ruta `[despachoId]/*` (page + loading + `_components/{despacho-record,despacho-vista}`) y revertir los 2
cambios aditivos en `…/despachos/page.tsx` (import + `EntityLink`). Sin migration/seed/engine → rollback trivial.
