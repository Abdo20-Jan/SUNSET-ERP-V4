# PR-C1 — Overview del center Comex (piloto)

**Goal:** Convertir la hub page `/comex` (hoy 3 cards de atajos) en un overview de center estilo NetSuite: faja de KPIs reales + atajos + embarques recientes. Fija el patrón a replicar en Tesorería/Contabilidad.

**Arquitectura:** Reutiliza componentes existentes vía cross-route import (patrón ya usado por el dashboard y los 7 tabs del BI): `KpiCard`, `MonedaToggle`, `EmbarquesRecientesCard`, `PageHeader`. Nueva server-service `getResumenComex` (1 groupBy + suma de deuda) con helper puro testeable. Sin schema. Rutas inalteradas.

**Tech:** Next 16 RSC · Suspense · `@/lib/decimal` (`sumMoney`) · vitest node (helper puro, sin Testcontainers).

## Global Constraints
- No promover componentes (KpiCard lo importan 8 archivos) → import cross-route como ya se hace.
- Reusar `convertirMonto`/`MonedaToggle` para la deuda USD (presentación ARS/USD).
- `monedaPreferida` default USD (igual que dashboard/compras/ventas).
- Gates: typecheck + biome:ci + test verdes.

## Task 1: servicio `getResumenComex` + helper puro

**Files:** Create `src/lib/services/comex-overview.ts`, `test/comex-overview.test.ts`

- Helper puro `resumirEmbarquesPorEstado(conteos)` → buckets: total, activos (= total − borradores − cerrados), enTransito (EN_TRANSITO+EN_PUERTO), enAduana (EN_ZONA_PRIMARIA+EN_ADUANA+DESPACHADO), borradores, cerrados.
- `getResumenComex()`: `db.embarque.groupBy({by:["estado"]})` + `getSaldosExteriorPorProveedor()` → `{ ...buckets, deudaExteriorUsd: sumMoney(saldos.map(s=>s.saldoUsd)).toString() }`.
- Test del helper puro: estados mixtos → buckets correctos; lista vacía → todo 0.

## Task 2: reescribir `/comex` como overview

**Files:** Modify `src/app/(dashboard)/comex/page.tsx`

- `PageHeader` "Comex" + `MonedaToggle`.
- Faja de 4 `KpiCard` (Suspense): Embarques activos (info) · En tránsito (neutral) · En aduana (warning) · Deuda exterior (warning, `convertirMonto` USD→pres).
- Grid de atajos: mantener los 3 cards actuales (Embarques, Proveedores exterior, Simulaciones).
- `EmbarquesRecientesCard` (Suspense) con `getEmbarquesRecientes`.

## Verificación
typecheck + biome:ci + test → review adversarial → PR + auto-merge → verificación visual en prod (dono).
