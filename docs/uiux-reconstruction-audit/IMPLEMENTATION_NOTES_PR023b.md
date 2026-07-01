# IMPLEMENTATION_NOTES_PR023b — CX-06 · Costos read-only en la ficha del Despacho ⛔

**PR:** `feat(comex): CX-06 costos read-only en la ficha del despacho (PR-023b)`
**Branch:** `pr-023b-comex-despacho-costos-readonly` (base limpia de `origin/main`; PR-023a `#360` + PR-023-pre `#359`
ya mergeados — sin stacking).
**Tipo:** record-migration (cost tab enrichment) · Onda 2 · criticidad MÁXIMA. Sub-PR de PR-023, después de PR-023a.

## Qué hace

Convierte el **placeholder** de la pestaña **Costos** de la ficha del despacho
(`comex/embarques/[id]/despachos/[despachoId]`) en una **vista de costo read-only completa**: resumen landed,
totales por componente, costo unitario por SKU (resumen), tributos/percepciones clasificados (capitalizable vs
crédito fiscal vs percepción recuperable) y un **indicador de consistencia** (memoria ≡ costo persistido/stock **y**
memoria ≡ asiento DEBE mercadería). **DISPLAY-only · motor/actions/schema/permisos INTOCADOS · gate único
`VER_COSTO_LANDED`.**

## Archivos

**Creados:**
- `…/[despachoId]/_components/costos-vista.ts` — proyección read-only `proyectarCostos(despachoId, vista, financiero,
  verCosto)` → `CostosVista | null`. Consume `obtenerMemoriaDespacho` (agregado read-only que envuelve el motor) +
  los STORED ya mascarados de `DespachoFinanciero`. Helpers (CC ≤ 8 c/u): `esCostosAbiertos`, `clasificarTributos`,
  `mapFacturas`, `mapPorItemRows`, `evaluarConsistenciaPersistido`, `evaluarConsistenciaAsiento`, `buildCruzado`.
- `…/[despachoId]/_components/costos/` — 6 sub-bloques DISPLAY + el dispatcher:
  `costo-resumen-landed.tsx`, `costo-totales-componente.tsx`, `costo-por-item.tsx`,
  `costo-tributos-percepciones.tsx`, `costo-facturas-vinculadas.tsx`, `costo-consistencia.tsx`,
  `costos-tab-content.tsx` (dispatcher por `kind`).
- `test/comex-despacho-costos-vista.test.ts` — 18 tests (mock-based, sin Docker).
- `docs/uiux-reconstruction-audit/IMPLEMENTATION_NOTES_PR023b.md` — este archivo.

**Modificados (aditivo — sólo wiring de la pestaña Costos):**
- `…/[despachoId]/page.tsx` — fetch **lazy** de `costos` (sólo cuando `activeTab==="costos"` y dentro de la rama
  `verCosto`) + prop `costos` a `DespachoRecord`.
- `…/[despachoId]/_components/despacho-record.tsx` — se eliminó el placeholder `CostosTab` y en el dispatcher la
  entrada `costos` ahora monta `<CostosTabContent costos={costos} />`; threading del prop `costos` por
  `DespachoRecord` → `DespachoTabContent`. Las otras 7 pestañas quedaron **iguales**.

**NO tocados (prohibidos):** `prisma/schema.prisma`, migrations, auth/JWT/sesión, modelo/catálogo de permisos,
`services/comex.ts`, `services/despacho-parcial.ts` (`calcularCostoLandedDespacho`), `lib/actions/despachos.ts`,
actions de embarques/contenedores/vep, y motores de asiento/stock/costo/rateio. `despacho-memoria.ts` **no** se tocó.

**CALL/IMPORT-only (read-only, sin editar):** `getAsientoDetalle` (`lib/actions/asientos.ts`) se **llama** para la
consistencia B; de `cuenta-registry.ts` se **importa** la ref simbólica `EMBARQUE_CODIGOS.MERCADERIAS.codigo`
(1.1.7.01, nunca literal).

## Mapa dato → fuente (NADA se recomputa)

| Bloque | Dato | Fuente |
|---|---|---|
| Resumen landed | total / FOB nacionalizado / capitalizables + badge `baseRateio` | `memoria.landed.{costoTotalArs, nacionalizadoArs, capitalizablesArs}` + `memoria.baseRateio` |
| Totales por componente | FOB · tributos cap. · facturas DESPACHO · capitalizables · total | `memoria.landed.{nacionalizadoArs, tributosCapitalizablesArs, facturasCapitalizablesArs, capitalizablesArs, costoTotalArs}` |
| Costo por ítem (resumen) | código/nombre · cantidad · unit landed · total | `memoria.landed.porItem[]` ⨝ `vista.items` (por `itemDespachoId`) |
| Tributos/percepciones | DIE/Tasa/Arancel=Capitalizable; IVA/IVAadic=Crédito fiscal; IIBB/Ganancias=Percepción recuperable | `financiero.{die,tasaEstadistica,arancelSim,iva,ivaAdicional,iibb,ganancias}` (STORED) |
| Facturas vinculadas | proveedor · número · momento · total ARS + badge capitalizable (sólo DESPACHO) | `vista.facturas[]` + `financiero.totalArsPorFactura` (STORED) |
| Consistencia | veredicto + Δ (display) | A: `memoria.landed` vs `financiero` · B: `getAsientoDetalle` (DEBE 1.1.7.01) |

## Prueba: no recompute / motor intocado

- La pestaña sólo llama `obtenerMemoriaDespacho` (lectura read-only que invoca el motor `calcularCostoLandedDespacho`
  SIN escribir — patrón sancionado y golden-testeado en PR-023-pre, CRIT-05 caso a). **Nunca** llama al motor directo,
  **nunca** recomputa el rateio en la UI. `import type { CostoLandedResult }` es type-only (sin import runtime de la
  engine).
- Prueba estructural: el diff sólo toca la ruta `[despachoId]/*` (nuevos archivos + 2 wiring aditivos) y este doc.
  Cero archivos de `services/comex.ts`, `services/despacho-parcial.ts`, `lib/actions/*`, `prisma/schema.prisma`,
  migrations, auth o permisos.
- **Goldens verdes (motor byte-idéntico):** `comex-despacho-memoria.golden` 5/5, `golden-costo-landed-despacho` 2/2,
  `costo-landed-despacho` 6/6, `despacho-parcial` 17/17, `asiento-despacho-cruzado` 2/2,
  `despacho-cruzado-capitalizacion-stock` 5/5, `validar-invariantes-comex` 9/9 (**46/46**).

## Prueba: masking server-side (G-06/G-10 · CRIT-10)

- Gate ÚNICO `VER_COSTO_LANDED` (`costos.verLanded`), resuelto en `page.tsx` con `puedeVerCostoLanded()` y pasado como
  `verCosto`. NO se usa `ver_costo_comex`; NO se creó ninguna clave.
- `proyectarCostos` devuelve `null` cuando `!verCosto || financiero === null` **antes** de llamar a
  `obtenerMemoriaDespacho` → ningún valor de costo se computa ni se serializa al cliente. Test:
  `obtenerMemoriaDespacho` **no se invoca** sin permiso.
- Lazy: la memoria sólo se computa al abrir la pestaña Costos → fuera de ahí ni siquiera se consulta.
- **Anti-leak consistencia B:** `getAsientoDetalle` devuelve `lineas[].debe` (sensible, gateado sólo por `auth()`).
  Todo el cómputo vive server-side dentro de la rama `verCosto`; al DTO cliente sólo cruzan **veredicto (enum) + Δ
  redondeado**, nunca el `debe` crudo ni las líneas (test `anti-leak`: el objeto sólo tiene `{kind, delta}`).
- Sin `VER_COSTO_LANDED`, la pestaña muestra el mensaje honesto
  `"Valores de costo ocultos — requiere el permiso «Ver costo landed»."`.

## Indicador de consistencia (decisión del dueño: **Ambas A + B**) — DISPLAY-only, NO bloquea

- **A · memoria ≡ persistido/stock:** por ítem `round2(costoUnitarioLandedArs)` vs `costoUnitarioPorItem` STORED (ambos
  2dp → robusto al redondeo, evita el falso alarme del agregado). Ancla golden #2.
- **B · memoria ≡ asiento:** Σ `debe` de la cuenta mercadería (1.1.7.01, ref simbólica) vs `landed.costoTotalArs`.
  Ancla golden #3.
- **Sólo `CONTABILIZADO`.** `BORRADOR` → veredicto `PREVIEW` (el `costoUnitario` STORED es 0 hasta contabilizar — sin
  esto, A gritaría "discrepancia" en todo borrador, el camino "Simular"). `ANULADO`/sin asiento/sin línea → `NO_APLICA`.
- Δ ≤ ARS 0,01 ⇒ `CONSISTENTE`. **Jamás bloquea ni muta** (a diferencia del cierre real del motor).

## Disponibilidad de datos de la consistencia

- A: 100% read-only desde `memoria.landed` + `financiero` (ya en la ficha). Sin lecturas extra.
- B: `getAsientoDetalle` (read-only existente). Si `{ok:false}` o no hay línea 1.1.7.01 → `NO_APLICA` (sin crash).

## Edge cases manejados

`!verCosto`/`financiero=null` → `null` (oculto) · costos sin cerrar (throw conocido) → `COSTOS_ABIERTOS` (catch
**estrecho**: cualquier otro error —p.ej. embarque faltante— **se re-lanza**) · `LEGACY` (sin `itemContenedor`) →
fallback resumen STORED + tributos + facturas (sin per-SKU/landed) · `BORRADOR` → consistencia `PREVIEW` · `ANULADO` →
consistencia `NO_APLICA` · facturas `ZONA_PRIMARIA` marcadas **no capitalizables** (sólo DESPACHO entra en el landed,
filtro espejo de la memoria) · join por ítem con fallback (`porItem` sin match en `vista.items` → usa `productoId`).

## Boundary PR-023c (no cruzado)

`costo-por-item` es **resumen** (código, cantidad, unit landed, total). La memoria detallada (participación por línea,
**ajuste de redondeo**, badge de función por línea, `[Ver memoria]`/`MemoriaCalculoWindow`), Simular y export = PR-023c.
`baseRateio` se muestra como **un único badge a nivel despacho**. Sin worklist global `/comex/costos`. Sin "costo
gerencial".

## Validación (resultados)

- `pnpm prisma generate` → OK.
- `pnpm typecheck` → OK (0 errores).
- `pnpm biome:ci` → exit 0 (sólo warnings preexistentes).
- `pnpm build` → OK (la ruta `[despachoId]` compila).
- `pnpm test` → verde (suite completa). Nuevo `comex-despacho-costos-vista` **18/18**; goldens/engine **46/46**.
- **`pnpm db:validar-stock` / `pnpm db:validar-asientos` — NO ejecutados localmente a propósito:** corren contra
  `DATABASE_URL` (default = PRODUCCIÓN/Railway) → condición de STOP. Su cobertura de invariantes (stock + asientos)
  está garantizada por `validar-invariantes-comex.test.ts` (9/9, Postgres efímero vía Testcontainers) **y** por la
  prueba estructural "motor intocado" (el diff no toca ningún archivo de motor/stock/asiento/action/schema). En CI
  corren contra DB segura.

## QA manual (env local seguro — Postgres descartable; NUNCA prod/Railway; admin/admin123)

- Con `VER_COSTO_LANDED`: pestaña Costos muestra resumen landed + totales por componente + per-SKU + tributos/
  percepciones clasificados + facturas + (si CONTABILIZADO) consistencia A/B.
- Sin `VER_COSTO_LANDED`: verificar en Network que ningún valor de costo está en el payload; mensaje honesto.
- Despacho con costos abiertos → mensaje "cerrá los costos…". LEGACY → resumen STORED + nota.
- El resto de la ficha (023a) y los flujos lista/crear/contabilizar/anular **sin cambios**.

## Rollback

Revertir `CostosTab`/dispatcher al placeholder de PR-023a, quitar `costos-vista.ts` + `costos/` + el fetch aditivo en
`page.tsx`. Sin migration/seed/engine → rollback trivial.
