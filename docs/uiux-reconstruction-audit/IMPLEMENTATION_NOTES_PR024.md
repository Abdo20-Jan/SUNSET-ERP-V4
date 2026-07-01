# PR-024 · CX-04 · Comex · Containers e Desconsolidación — Notas de implementación

**Tipo:** worklist-migration + record-migration (UI-only, greenfield shells).
**Scope entregado:** PR-024a (worklist global) + PR-024b (ficha del contenedor), ambos detrás de
`isContenedorDesconsolidacionEnabled()`.
**Base:** rama limpia de `origin/main` (`c25db7e4`, incluye #362 ya mergeado). Sin stacking sobre PR-023.

---

## 1. Restricción central (UI-only)

DISPLAY de datos almacenados + **dos proyecciones nuevas de sólo lectura** + LINK a acciones/flujos existentes.
El motor (desconsolidación / counters / lock / despacho-parcial / rateio / stock / asiento) **no se toca ni se
recalcula**. Con la flag OFF la feature es invisible/inerte → cero regresión.

## 2. Archivos

### Creados (024a — worklist)
- `src/lib/services/contenedor-worklist.ts` — proyección read-only `listarContenedores(filtros, tx?)` →
  `ContenedorRow[]` (11 columnas canónicas + contexto). Agrega los counters de `ItemContenedor` vía un único
  `groupBy` (sin N+1). Short-circuit con la flag apagada. **Sin llamada al motor.**
- `src/app/(dashboard)/comex/contenedores/page.tsx` — worklist global (EnterpriseDataGrid). Gate de flag +
  `VER_COSTO_LANDED`.
- `src/app/(dashboard)/comex/contenedores/_components/` — `contenedores-worklist.tsx` (grid + filtros +
  saved-views in-memory + expand), `contenedores-columns.tsx` (11+2 cols, freeze 1-3, columna costo gated),
  `contenedores-chips.tsx` (`EstadoContenedorBadge` con tono), `contenedores-expanded-row.tsx` (mini-ficha).

### Creados (024b — ficha)
- `src/lib/services/contenedor-ficha.ts` — proyección read-only `obtenerContenedorFicha(id, verCosto, tx?)` →
  `ContenedorFicha | null` (datos + packing list por SKU + despachos agrupados + docs de la desconsolidación).
  Short-circuit con la flag apagada. **Sin llamada al motor.**
- `src/app/(dashboard)/comex/contenedores/[id]/page.tsx` — fetch + gate flag + `puedeVerCostoLanded()` +
  `resolveActiveTab`.
- `src/app/(dashboard)/comex/contenedores/[id]/_components/contenedor-record.tsx` — record (header +
  6 abas Resumen / Packing list / Documentos / Despachos / Costos / Auditoría).

### Test
- `test/comex-contenedor-worklist.test.ts` — 8 tests (worklist + ficha): agregación de counters, omisión de costo
  sin `VER_COSTO_LANDED`, inercia con flag OFF, filtros, divergencia, costo FC total.

### Modificados
- **Ninguno.** Este PR es 100% aditivo (sólo archivos nuevos).

### Entrada de nav — DIFERIDA (decisión del dueño)
No se agrega el item **"Contenedores"** a `nav-model.ts` ni a `nav-config.ts` en este PR. Motivo: con la feature OFF
(default) un item de nav mostraría una entrada falsa que hace 404 ("visible-pero-inerte"), y el dueño lo rechazó
explícitamente; tampoco se quiere una permission falsa ni duplicar la flag server-only en el cliente. El gate de nav
por feature-flag (esconder el item cuando OFF) no es simple/centralizado hoy (la nav es client-side y sólo filtra por
`permission`; la flag es env server-only). Por eso la entrada de nav queda para un **PR futuro de nav/feature-flag**.
Mientras tanto, las rutas siguen detrás de `isContenedorDesconsolidacionEnabled()` y son alcanzables por URL directa
(con la flag ON). Los links internos existentes de la ficha (a embarque / despacho / desconsolidación /
investigación) se mantienen.

### NO tocados (verificado por `git diff --name-only`)
`prisma/schema.prisma`, migraciones, auth/permisos, y el motor Comex:
`services/{comex,despacho-parcial,contenedor,stock,asiento-automatico}.ts`,
`lib/actions/{contenedores,despachos,embarques,vep-*}.ts`, y los forms de desconsolidación/investigación.

## 3. Mapa columna/aba → fuente

| Worklist (11 cols) | Fuente |
|---|---|
| 1 Número (frozen) | `Contenedor.numeroContenedor` → EntityLink a `[id]` |
| 2 BL/HBL (frozen) | `numeroBL` / `numeroHBL` → EntityLink |
| 3 Status (frozen) | `estado` (`ContenedorEstado`) |
| 4 Fecha salida | `fechaSalidaOrigen` |
| 5 Fecha llegada | `fechaLlegadaPuerto` |
| 6 Depósito fiscal | `depositoFiscal.nombre` |
| 7-11 Declarada/Física/Disponible/En despacho/Despachada | Σ de los counters de `ItemContenedor` (`groupBy._sum`) |
| (+contexto) Proceso · Proveedor | `embarque.codigo` / `embarque.proveedor.nombre` (necesarios para la vista global) |
| (+gated) Costo FC (USD) | Σ `costoFCUnitario × cantidadDeclarada` — **columna omitida sin `VER_COSTO_LANDED`** |

| Ficha (6 abas) | Fuente |
|---|---|
| Resumen | campos de `Contenedor` + depósitos + fechas + pesos |
| Packing list | `ItemContenedor` por SKU: declarada/física/**divergencia (física−declarada)**/disponible/en despacho/despachada + costo unit. gated |
| Documentos | `desconsolidacion.documentosUrls`/`fotosUrls` (display) + link al flujo de desconsolidación |
| Despachos | `itemsDespacho` agrupado por despacho → EntityLink a `/comex/embarques/[embarqueId]/despachos/[despachoId]` |
| Costos | `costoFCUnitario` por SKU + total — **gated** |
| Auditoría | `getAuditLog("Contenedor", id)` + `AuditTrail` |

Mutaciones = **LINK** a flujos existentes (payloads byte-idénticos, nada reescrito): "Desconsolidar / Conferencia" →
`[id]/desconsolidacion`; "Investigación" → `[id]/investigacion`; despachos → record de despacho (PR-023a).

## 4. Prueba de flag-gating (OFF = inerte / cero regresión)

- **Page (worklist y ficha):** `if (!isContenedorDesconsolidacionEnabled()) notFound();` como PRIMERA línea, antes
  de cualquier fetch → con la flag apagada ninguna query corre y la ruta responde 404.
- **Defensa en profundidad:** `listarContenedores` y `obtenerContenedorFicha` hacen short-circuit (`{rows:[],total:0}`
  / `null`) con la flag apagada, ANTES de tocar la BD. Cubierto por tests ("con la flag APAGADA devuelve vacío sin
  tocar la BD" / "devuelve null con la flag apagada").
- **Nav:** decisión del dueño = **sin entrada de nav en este PR** (para no mostrar un item falso/inerte con la flag
  OFF). Se difiere a un PR de nav/feature-flag. Las rutas siguen 404 con la flag OFF por el gate de la page.

## 5. Prueba de "motor intocado / counters read-only / sin recompute"

- `git diff --name-only` no incluye ningún archivo de motor/acción/schema (ver §2).
- Los counters (disponible/en despacho/despachada) se LEEN de `ItemContenedor` y se agregan con `groupBy._sum` —
  nunca se recalculan.
- `costoFCTotal`/`costoFCUnitario` son AGREGACIONES DE DISPLAY de valores ALMACENADOS (`Σ costoFCUnitario × cantidad`).
  No invocan `calcularRateioZonaPrimaria` ni persisten nada.
- Suites del motor verdes tras el cambio: familia `contenedor` **42/42** (incl. `contenedores-actions`,
  `avanzar/revertir/cerrar-costos`), `desconsolidacion` verde, `nav-config`/`nav-permissions` **17/17**.

## 6. Prueba de omisión de costo server-side (anti-leak, G-10 / §9-estrutural 8)

- **Worklist:** el `select` de `Contenedor` NUNCA incluye campos monetarios. El costo se resuelve en una query
  SEPARADA (`costoFCPorContenedor`) que sólo se ejecuta con `verCosto` → sin permiso, `costoFCTotal = null` y la
  columna "Costo FC" no se agrega (`return verCosto ? [...base, costo] : base`).
- **Ficha:** `fichaSelect` excluye `costoFCUnitario`; se consulta aparte (`costoFCPorItem`) sólo con `verCosto`.
  Sin permiso, `costoFCUnitario`/`costoFCTotal = null`, la columna "Costo FC unit." no se renderiza y la aba Costos
  muestra el mensaje de permiso.
- Cubierto por tests ("omite el costo (server-side) sin VER_COSTO_LANDED" en worklist y ficha).
- Clave usada: **`PERMISOS.VER_COSTO_LANDED` (= `costos.verLanded`)**. NO se usa `ver_costo_comex`.

## 7. Evidencia de payload idéntico (acciones linkeadas)

No se creó ni modificó ninguna server action. La ficha sólo NAVEGA (via `<Link>`/`EntityLink`) a rutas existentes
(`[id]/desconsolidacion`, `[id]/investigacion`, record de despacho). Los formularios de esas rutas siguen invocando
sus acciones con los mismos payloads — este PR no los toca.

## 8. Omitido / diferido (documentado)

- Conferencia física / divergencia / bloqueo / lock pesimista / expiración de rascunho (§9-funcional 1-8) = **MOTOR**;
  se LINKEA el flujo de desconsolidación existente, no se reimplementa.
- Upload de foto/video de la desconsolidación (§9-estrutural 5) → **DIFERIDO** (sin infra de storage; se muestran los
  docs existentes).
- Export auditado de la worklist → diferido (no requerido por 024a; `exportSurface={false}` como en CX-02).
- La "mini-ficha" de hover de la spec se realiza como **expansión de fila** (mismo patrón que CX-02). "Free-time" →
  diferido (sin dato en el schema).

## 9. Validación ejecutada

```
pnpm prisma generate   ✓
pnpm typecheck         ✓ (sin errores)
pnpm build             ✓ (rutas /comex/contenedores y /comex/contenedores/[id] en el árbol)
pnpm biome:ci          ✓ (EXIT 0; sólo warnings pre-existentes ajenos)
pnpm test comex-contenedor-worklist   ✓ 8/8
pnpm test contenedor                  ✓ 42/42 (familia)
pnpm test nav-config nav-permissions  ✓ 17/17
```

`pnpm db:validar-stock` / `db:validar-asientos`: **no ejecutados** — requieren una BD sembrada y en este entorno la
única BD disponible sería producción (Railway), lo cual está prohibido. El motor está provadamente intocado
(`git diff --name-only`), por lo que los invariantes de stock/asiento no pueden verse afectados por este cambio
UI-only. Deben correrse contra una BD local descartable antes del merge si se desea el seguro adicional.

## 10. QA manual (env local seguro — flag ON)

- `/comex/contenedores` lista todos los contenedores (11 cols, freeze 1-3, filtros proceso/proveedor/status/depósito,
  saved-views, expand con breakdown disponible); Número → ficha.
- Ficha: Resumen / Packing list (declarada/física/divergencia/disponible por SKU) / Documentos / Despachos (link al
  record) / Costos / Auditoría; desconsolidación/investigación abren los flujos existentes sin cambios.
- Sin `VER_COSTO_LANDED`: columna/valores de costo **ausentes** (el server omite, no "—").
- Flag OFF: worklist/ficha responden 404; el ERP legado no cambia (ninguna query de contenedor corre).

## 11. Rollback

Eliminar las páginas (`contenedores/page.tsx`, `[id]/page.tsx` + `_components`), las dos proyecciones
(`contenedor-worklist.ts`, `contenedor-ficha.ts`) y el test. No hay item de nav ni migración/estado que revertir.
