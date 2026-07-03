# IMPLEMENTATION NOTES — PR-026 · Finanzas FIN-01 + FIN-02 (worklists de gestión CxC/CxP por documento pendiente)

- **Branch:** `pr-026-finanzas-cxc-cxp` (limpia de `origin/main` @ `ccafd5f8` — 025c mergeado)
- **Tipo:** worklist-migration · Onda 2 · UI-only + read-only · motor intocado
- **Precondición dura verificada:** paraguas PR-025 completo en `origin/main` — 025a #364 (`3e6b6901`), 025b #365 (`038b51b2`) + #366 (`a58aabf5`), 025c #367 (`ccafd5f8`).

## 1) Decisión de placement (gate A.5 del prompt — decidida con el dueño)

**Opción A** (elegida vía AskUserQuestion): rutas nuevas
`src/app/(dashboard)/finanzas/{cuentas-a-cobrar,cuentas-a-pagar}/` como **vista de gestión**
("Finanzas programa · Tesorería ejecuta", OD-09). Las páginas de tesorería quedan **byte-idénticas**
como vista de ejecución. La opción B (view-modes sobre las páginas de tesorería) se descartó por
modificar páginas 025 recién mergeadas y ensuciar el rollback.

## 2) Archivos

**Nuevos (16):**

| Archivo | Rol |
|---|---|
| `src/app/(dashboard)/finanzas/cuentas-a-cobrar/page.tsx` | RSC FIN-01: gate página-entera + KPIs + presets URL |
| `.../fin-cxc-presentacion.ts` | helpers puros client-safe: flatten, urgencia, vistas, BUCKET_* |
| `.../fin-cxc-columns.tsx` | factory de columnas + renderers nombrados (CCN≤8) |
| `.../fin-cxc-worklist.tsx` | client: EnterpriseDataGrid + expand + export |
| `.../fin-cxc-export-button.tsx` | botón export (máscara FE = reflejo) |
| `.../loading.tsx` | skeleton (espejo 025c) |
| `src/app/(dashboard)/finanzas/cuentas-a-pagar/page.tsx` | RSC FIN-02: ídem + **gate que la CxP de tesorería no tiene** |
| `.../fin-cxp-presentacion.ts` | ídem CxP + `pagarHref` verbatim + `finCxpRowId` |
| `.../fin-cxp-columns.tsx` | ídem CxP + `DocumentoLink` por origen + chip Origen |
| `.../fin-cxp-worklist.tsx` / `.../fin-cxp-export-button.tsx` / `.../loading.tsx` | ídem |
| `src/lib/services/fin-cxc-worklist.ts` | proyección no-call NUEVA (ver §4) |
| `src/lib/actions/fin-cxc-export.ts` / `fin-cxp-export.ts` | export auditado server-side |
| `test/fin-cxc-worklist.test.ts` / `test/fin-cxp-worklist.test.ts` | gate no-call + flatten-parity + hrefs (11+11 casos) |
| `test/fin-cxc-export.test.ts` / `test/fin-cxp-export.test.ts` | gate export + re-lectura + native-first + auditoría (5+5) |

**Modificados (2):**

- `src/components/layout/nav-config.ts` — aditivo: `"/finanzas"` en `routePrefixes` del center
  `finanzas` + sección nueva **"Gestión financiera"** con 2 items (`permission:
  PERMISOS.VER_SALDO` — reflejo de nav; el control real es server-side; clave BASE ⇒ cero cambio
  visible con RBAC off). Nota: este archivo es el shell LEGADO (kill-switch
  `TOP_NAV_ENABLED=false`) — se mantiene coherente con el nav vivo.
- `src/components/layout/nav-model.ts` — **descubrimiento del QA visual**: el nav que renderiza es
  ESTE (top-nav PR-002 / `ModuleMegaMenu`), no `nav-config.ts`. Su propio header decía que
  FIN-01/FIN-02 apuntaban a `/tesoreria/*` sólo porque "Q5 Finanzas×Tesorería fica diferido" — Q5
  es exactamente lo que este PR resuelve (placement A). Cambio: 2 items nuevos "Cuentas a cobrar/
  pagar (gestión)" con `pageCode` FIN-01/FIN-02 + `permission: VER_SALDO` al tope del módulo
  Finanzas; los items de ejecución `/tesoreria/*` se CONSERVAN debajo (sin pageCode — la ruta de
  ejecución sigue accesible, cero navegación rota); comentario del header actualizado.
  `test/nav-permissions.test.ts` sigue verde.

**Prohibidos intocados:** `prisma/schema.prisma`, migrations, `cuentas-a-cobrar.ts`,
`cuentas-a-pagar.ts`, `aging-presentacion.ts`, `movimientos-tesoreria.ts`, `pago-exterior.ts`,
VEP/retenciones, motor de asientos, componentes 025 de tesorería, `enterprise-data-grid.tsx`,
permisos-catalog/resolver/seed. `git diff --name-only` = sólo `nav-config.ts`.

## 3) Mapa columna → campo del servicio (canon OD-06: consume-or-omit)

### FIN-01 (fila = venta pendiente; fuente: `getSaldosPorClienteConAging().ventas[]` FLATTEN)

| # canon | Columna canon | Shipped | Fuente |
|---|---|---|---|
| 1 | Cliente | ✅ (pinned) | `clienteNombre`+`cuentaCodigo`+`cuit` del padre; EntityLink `/maestros/clientes/[id]` |
| 2 | Factura | ✅ (pinned) | `numero`; EntityLink `/ventas/[id]` |
| 3 | Parcela | ❌ OMITIDA | sin modelo de cuotas (schema: un único `fechaVencimiento` por Venta; cero `parcela\|cuota`) — no se fabrica "1/1" |
| 4 | Vencimiento | ✅ | `fechaVencimiento` → `DateBadge` |
| 5 | Moneda | ✅ | `moneda` |
| 6 | Saldo (DualCurrency) | ✅ | `montoNativo` + `fmtMontoPres` (native-first). `DualCurrencyAmount` de la spec NO existe en el repo — el equivalente real es este par |
| 7 | Días atraso | ✅ | `diasParaVencer` negativo → ámbar 1–15 / rojo >15 |
| 8 | Estado (9 estados) | ◐ bucket-derived (pinned) | `bucket` (vencida/próxima/al día/sin fecha). Los 9 estados de la spec no tienen backing model → FIN-03 |
| 9 | Próxima acción | ❌ FIN-03 (PR-035) | sin modelo de gestión/promesas |
| 10 | Vendedor | ❌ OMITIDA | NO está en el DTO (select de `db.venta.findMany` no lo trae); extensión de servicio sólo con aprobación |
| 11 | Responsable cobranza | ❌ FIN-03 | sin modelo |
| + | Acciones | ✅ | Link "Cobrar" = `cobrarHref(f.cliente)` **VERBATIM 025c** (per-cliente, saldo contable) |

Congeladas: **Cliente · Factura · Estado** (canon congela 1–3+8; con Parcela omitida quedan 3 pins).
Expand = `VentasPendientesTable` **REUSADA de 025c** con el padre completo (todos los pendientes del
cliente; recibos parciales NO están en el DTO → FIN-03). Vistas: `?vista=hoy|prox7|vencidas`
(presets URL server-side, lección PR-010); `[Promesas]/[A reconocer]/[En cobranza]…` → FIN-03.
`?agrupar=cliente` = SÓLO presentación (orden natural del servicio, contiguo por cliente, vs orden
de urgencia default) — mismas filas/totales, trabado por test; group-by real con subtotales no
existe en el grid (cero `getGroupedRowModel`) y extenderlo violaría los prohibidos.

### FIN-02 (fila = factura/vencimiento; fuente: `getSaldosPorProveedorConAging().facturas[]` FLATTEN)

| Columna canon | Shipped | Fuente |
|---|---|---|
| Proveedor | ✅ (pinned) | `proveedorNombre`+`cuit`; EntityLink `/maestros/proveedores/[id]` |
| Documento | ✅ (pinned) | `numero`; EntityLink `/compras/[id]` (origen compra) / `/gastos/[id]` (gasto); **texto** si origen=embarque (el DTO no expone `embarqueId`, sólo `referencia` textual — extensión aditiva sólo con aprobación) |
| Origen | ✅ | `origen` → `ORIGEN_LABEL`/`ORIGEN_BADGE` **REUSADOS** de `pago-por-factura.tsx` (exports 025b-2) + chip de filtro |
| Vencimiento / Moneda / Saldo / Días | ✅ | ídem FIN-01 |
| Estado (10 estados) | ◐ bucket-derived (pinned) | ídem — Borrador/Aprobado/Programado/etc. sin backing → FIN-03/04 |
| Prioridad | ❌ | sin backing model |
| Programado / Banco sugerido / lotes / impacto en caja | ❌ FIN-04 (PR-036) | exige modelo nuevo |
| Aprobación | ❌ | sin linkage por título (motor PR-012 es genérico e inerte) |
| Proceso Comex (EntityLink) | ◐ | columna **Referencia** textual (código de embarque) |
| + Acciones | ✅ | Link "Pagar" = `pagarHref(f.proveedor)` — URL **VERBATIM** del `PagarSoloCell` (saldos-proveedores, 025b), identidad trabada por test |

Expand = pendientes del mismo proveedor (padre anidado, cero queries). Vistas: misma familia.
RowId = `origen-id` (criterio `facturaKey` 025b-2; el prefijo evita colisión uuid×numérico).

## 4) Servicios/proyecciones — qué se reusó y qué se creó

- **FIN-02 NO crea servicio:** reusa `listarSaldosProveedoresWorklist(verSaldo)` (025b) tal cual —
  fit exacto (no-call + `SaldoProveedorAging[]`).
- **FIN-01 crea `fin-cxc-worklist.ts`** (proyección fina no-call → `getSaldosPorClienteConAging()`
  pass-through). No se reusó `listarCuentasACobrarWorklist` (025c) porque ésta también dispara
  `getCuentasACobrar()` — motor extra que la vista de gestión no consume.
- **Shapes client-safe:** FIN-01 importa los de `cuentas-a-cobrar-presentacion.ts` (025c, módulo
  puro compartido). FIN-02 **re-declara** duplicatas idénticas al DTO del servicio (precedente
  025b/c) porque la variante client-safe de `saldos-proveedores-columns.tsx` OMITE `referencia`
  (esa grid no la exhibía) y la de `pago-por-factura.tsx` no tiene `montoNativo`.
- **Duplicación deliberada FIN-01×FIN-02** (vistas/urgencia/BUCKET_*): las dos rebanadas no
  comparten archivos → el corte del split de contingencia PR-026a/b queda limpio.

## 5) Prueba de flatten-parity (grid/KPI == `aging-presentacion`)

- `test/fin-cxc-worklist.test.ts` + `test/fin-cxp-worklist.test.ts`:
  - conservación exacta: `flatten(...).length === Σ ventas/facturas`, rowIds únicos, padre por
    **referencia** (`toBe`), orden natural contiguo por cliente/proveedor;
  - paridad: `sumarBucketsNativos(flatten)` `toEqual` `sumarBucketsNativos(anidado)` y KPI string
    (`fmtMoney(convertirBucket(...))`) igual por bucket × moneda, fixture multimoneda con TC de
    cierre (1400) ≠ TC de emisión (1300);
  - anti-÷tc-ciego explícito: vencido USD = 100 + 50000/1400 = **135,71** (no 180000/1400=128,57);
  - `sin_fecha` colapsa en `al_dia` también en la vista aplanada;
  - ordenar/filtrar no mutan ni cambian el multiset (garantiza "agrupar no cambia totales").
- La page calcula los KPIs con los helpers server REALES (`sumarBucketsNativos`/`convertirBucket`
  importados de `@/lib/aging-presentacion`) sobre las MISMAS filas aplanadas del grid ([Todas]).
  No existe transcripción nueva de la matemática (no hay `fmtBucketPres` nuevo: cada fila muestra
  UN documento → `fmtMontoPres` directo; la agregación vive sólo en los KPIs, vía helpers 100%
  reusados). La variante per-item de `saldos-proveedores-columns.tsx:69` (deriva 1ct) NO se copió.

## 6) Prueba de masking `VER_SALDO` (server-side, 3 puntos por página)

1. **Page** (ambas): `puedeVerSaldo()` es la PRIMERA instrucción; sin permiso → "Acceso
   restringido" server-rendered ANTES de cualquier fetch (nada monetario entra al payload RSC;
   sin `PermissionGate` client como control).
2. **Proyección no-call:** `listarFinCxcWorklist(false)` / `listarSaldosProveedoresWorklist(false)`
   → `null` sin invocar motores (trabado: `expect(motor).not.toHaveBeenCalled()`).
3. **Export action:** `requireSessionUser()` + re-check `puedeVerSaldo()`; sin permiso NIEGA sin
   leer la proyección y sin auditar (trabado en test).
   FIN-02 nota: la página NUEVA no hereda el bypass residual de `/tesoreria/cuentas-a-pagar`
   (follow-up conocido de 025b, sigue pendiente ALLÁ — fuera del alcance de este PR).
   Nav: items con `permission: PERMISOS.VER_SALDO` (reflejo UX, no control).

## 7) Evidencia de payload idéntico (flujos hospedados)

- **Ninguna mutación nueva** en todo el PR (las únicas server actions nuevas son los 2 exports
  read-only). Los CTAs son `<Link>` de prefill al flujo EXISTENTE `/tesoreria/movimientos/nuevo`:
  - FIN-01 "Cobrar": `cobrarHref` **importado** de 025c (misma función + mismo objeto padre por
    referencia ⇒ mismo string; test compara `cobrarHref(filaFlat.cliente) === cobrarHref(cliente)`
    y valida los 4 params contra el CTA legado).
  - FIN-02 "Pagar": `pagarHref` espeja **verbatim** el `PagarSoloCell` de
    `saldos-proveedores-columns.tsx` (incl. caso sin `cuentaContableId` → `?tipo=PAGO` pelado y
    sufijo " — N factura(s)"); identidad de URL trabada por 3 casos de test.
- Export auditado: server action re-lee la proyección con los MISMOS presets de la URL (nunca
  serializa lo que el client tiene), `auditarExportacion` ANTES de entregar (falla ⇒ propaga),
  recursos `finanzas-cuentas-a-cobrar` / `finanzas-cuentas-a-pagar`, evento `EXPORTACION`
  append-only visible en `/sistema/auditoria`.

## 8) Deudas heredadas conscientemente (documentadas, NO nuevas)

- Sort-key de columnas monetarias = agregado ARS del servicio (`Number(monto)`, TC de emisión)
  mientras el display es native-first al TC de cierre → en multimoneda el orden puede divergir del
  exhibido. Misma deuda registrada de 025b/c — corregir en conjunto, no acá.
- Gotcha de tooling descubierto: el parser TS de **Lizard** (gate Codacy) rompe con ternarios
  dentro de object literals en `.ts` (lee el `?` como propiedad opcional y funde el resto del
  archivo en una única "función" CCN>8). Fix aplicado: helpers nombrados `isoDia`/
  `diasAtrasoExport` en las export actions (de paso, CCN real ≤ 3). Verificado:
  `lizard -C 8 -l typescript` → 0 warnings en el código nuevo.

## 9) Validación (ejecutada en orden, post-fixes del review)

| Comando | Resultado |
|---|---|
| `pnpm prisma generate` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm build` | ✅ limpio (`rm -rf .next` previo); rutas `ƒ /finanzas/cuentas-a-cobrar` y `ƒ /finanzas/cuentas-a-pagar` en el route table |
| `pnpm biome:ci` | ✅ 0 errores (48 warnings pre-existentes de main; los `loading.tsx` nuevos emiten los MISMOS warnings que los de tesorería ya mergeados) |
| `pnpm test` | ✅ **166 files / 1271 tests** (1238 de main + 33 nuevos: 4 suites FIN con 32 casos + paridad) |
| `pnpm db:validar-asientos` | ✅ "Todas las invariantes del ledger contable están satisfechas" (Postgres descartable local, migrate deploy + seed — NUNCA prod) |
| Lizard CCN ≤ 8 (gate Codacy) | ✅ 0 warnings (62 funciones nuevas, avg CCN 1.7) |

## 10) Review multi-agente adversarial del diff (3 finders × verify)

7 hallazgos brutos → 4 confirmados (todos **minor**), 3 refutados/informativos:

- **CORREGIDO en este PR** — orden de la columna Vencimiento: `?? ""` ponía los sin-fecha PRIMERO
  en asc (compareAlphanumeric de TanStack ordena "" antes de todo ISO), invirtiendo la convención
  "sin fecha al final" de `porUrgencia`. Fix declarativo en ambos columns: `?? undefined` +
  `sortUndefined: "last"` (soportado por @tanstack/table-core 8.21.3).
- **Deuda heredada, deferida (documentada §8)** — sort-key monetaria ARS vs display native-first
  (2 hallazgos duplicados): espejo deliberado de 025b/c; corregir las 4 worklists juntas.
- **Pre-existente, follow-up** — CSV injection (CWE-1236) en el helper COMPARTIDO
  `src/lib/export/csv.ts` (`esc()` no neutraliza `=`,`+`,`-`,`@` iniciales): afecta a los 8
  consumidores de `toCsv` ya mergeados (PR-010/020/022d/025c…); endurecerlo acá cambiaría el
  comportamiento de exports ya en prod → fuera del alcance behavior-preserving de este PR.
  Sugerencia de fix global registrada (neutralizar sólo strings no-numéricos en `esc()`).
- Refutados/informativos: conformidad total con el prompt confirmada por el verificador (ningún
  archivo prohibido tocado, nav aditivo, CTAs byte-idénticos, consume-or-omit honesto).

## 11) QA visual ejecutado (Postgres descartable + dev server local, login admin/admin123)

Entorno: `postgres:18-alpine` efímero (puerto 55432) + `prisma migrate deploy` + seed;
`DATABASE_URL`/`DIRECT_DATABASE_URL`/`AUTH_URL` overrideados a localhost:3199 — **nunca
prod/Railway**. Evidencia (Playwright):

- **Gate real comprobado**: con JWT stale (usuario inexistente en el DB fresco) ambas páginas
  renderizan "Acceso restringido" server-side — nada monetario en el payload; tras login válido,
  renderizan completas.
- **FIN-01**: título/subtítulo con cross-link a tesorería, MonedaToggle (sin cotización cargada →
  "Cargar TC del día", degradación correcta), 4 vistas + "Agrupar por cliente" con URLs correctas,
  4 KPIs, grid con las 8 columnas (Cliente·Factura·Estado pinned), export button, empty state.
- **FIN-02**: ídem con 10 columnas (chip de filtro Origen incluido) y empty state propio.
- **Nav**: menú Finanzas del top-nav muestra "Cuentas a cobrar (gestión)"/"Cuentas a pagar
  (gestión)" al tope y conserva los items de ejecución `/tesoreria/*` debajo; navegación verificada
  por click; breadcrumb `finanzas > …` e InternalTabs OK.
- **Export auditado end-to-end**: click Exportar→CSV descargó
  `finanzas-cuentas-a-cobrar-<sello>.csv` con los 11 headers correctos, y el evento quedó en
  `AuditLog`: `accion=EXPORTACION, datosNuevos.pagina="finanzas-cuentas-a-cobrar", formato=csv,
  nFilas=0` — visible en `/sistema/auditoria` (fila "Exportación · Manual").
- **Tesorería byte-idéntica**: `git status` — cero archivos modificados bajo
  `src/app/(dashboard)/tesoreria/`.

**Spot-check numérico multimoneda EJECUTADO** (fixture SQL local: cliente ACME con 3 ventas
EMITIDAS — 100 USD @TC emisión 1300 vencida, 50.000 ARS vencida, 75.000 ARS próxima — + asiento
CONTABILIZADO 255.000 ARS en 1.1.3.01.000001; proveedor GLOBAL con compra 60.000 ARS vencida +
gasto 40.000 ARS próxima + asiento 100.000 ARS en 2.1.1.01.000001; cotización de cierre 1.400):

| Verificación | Esperado | Observado |
|---|---|---|
| FIN-01 KPI Total vencido (USD) | 100 + 50000/1400 = **135,71** (÷tc ciego daría 128,57) | **135,71** ✅ |
| FIN-01 KPI A vencer ≤7d / Saldo contable (USD) | 53,57 / 182,14 | 53,57 / 182,14 ✅ |
| FIN-01 filas Saldo (USD) | 100,00 · 35,71 · 53,57 (KPI == Σ grid) | idéntico ✅ |
| FIN-01 KPIs en ARS (TC correcto por perna) | 190.000 / 75.000 / 255.000 | idéntico ✅ |
| Cross-check `/tesoreria/cuentas-a-cobrar` (025c) | mismos 4 KPIs | 135,71/53,57/0,00/182,14 ✅ |
| Vistas server-side | vencidas=2 · prox7=1 · todas=3 filas | ✅ |
| `?agrupar=cliente` | mismas filas y KPIs (presentación pura) | ✅ |
| Expand | "Pendientes de ACME SA (QA) (3)" — VentasPendientesTable reusada | ✅ |
| CTA Cobrar | URL verbatim per-cliente (monto=255000.00, cuentaContableId=552) | ✅ |
| FIN-02 KPIs (USD) | 42,86 / 28,57 / 71,43 | ✅ |
| FIN-02 links por origen | `/compras/qa-compra-1` · `/gastos/qa-gasto-1` (numero = facturaNumero) | ✅ |
| FIN-02 chip Origen=Compra | 1 registro | ✅ |
| CTA Pagar | URL verbatim PagarSoloCell (monto=100000.00, "— 2 factura(s)") | ✅ |
| Exports (3) + AuditLog | CSV/XLSX descargados; eventos EXPORTACION con `pagina` correcta y preset `vista=vencidas` re-aplicado server-side (nFilas=2, excluye la próxima) | ✅ |
| Gate sin permiso (live) | JWT stale → "Acceso restringido" server-rendered, cero fetch/valor en payload (2 corridas) | ✅ |
| Páginas 025/Comex accesibles | 8/8 rutas → HTTP 200 | ✅ |
| `db:validar-asientos` | invariantes OK en DB limpio Y en DB con fixture | ✅ |

Nota de fixture: `Venta.total` se almacena en la moneda NATIVA de la venta (el motor deriva
`totalArs = total × tipoCambio`, `cuentas-a-cobrar.ts:342`) — el primer intento del fixture gravó
el total USD en ARS y el spot-check lo detectó de inmediato (grid mostró 130.000 en vez de 100),
prueba de que el check discrimina de verdad.

## 12) Rollback

Revertir el commit único: elimina `src/app/(dashboard)/finanzas/`, `fin-cxc-worklist.ts`, las 2
export actions, los 4 tests y las ~30 líneas aditivas de `nav-config.ts`. Ningún archivo
compartido queda alterado; tesorería no se toca.
