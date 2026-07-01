# IMPLEMENTATION NOTES — PR-025 · Tesorería TES-01/02/03 (worklists + drawers→FWW + gate de saldo)

> Onda 2 (adoção de padrões por módulo). UI-only, behavior-preserving. Split XL em
> **PR-025a** (TES-01 Bancos/Cajas) · **PR-025b** (TES-02 Pagos) · **PR-025c** (TES-03 Cobranzas).
> Este documento cobre a fatia entregue. Base: branch limpo de `origin/main` (`57cf96b5`).

## Decisões-chave (owner)

1. **Gate de saldo** = chave aditiva `tesoreria.verSaldo` (dimensão `CAMPO`), incluída em
   `USER_BASE_CLAVES` → **zero regressão** com `RBAC_ENABLED` OFF (espelha `VER_COSTO_LANDED`/PR-011).
   Helper `puedeVerSaldo()` em `permisos-masking.ts`. **Não** toca resolver/seed/schema (o seed
   `seedRbacFoundation` faz `upsert` iterando o catálogo → pega a chave nova sem mudança de código).
2. **Páginas compostas** (CxP/CxC/saldos-proveedores, PR-025b/c) → abordagem **conservadora**:
   grid só onde há lista limpa; preservar seções operacionais (VEP/batch-pago/aging). (Fora do 025a.)

## Escopo do gate `VER_SALDO` (definição)

Oculta **saldos de conta e agregados de saldo** (saldo das `cuentas` bancárias; futuro: overview
de tesorería, aging CxP/CxC). **Montante transacional** de um lançamento individual (monto de um
`movimiento`) **NÃO** é saldo: é lido de um asiento já gerado pelo motor (nunca recomputado) e segue
o comportamento atual (visível). Isso evita: (a) mascarar dado transacional client-side (violaria
"masking server-side"); (b) tocar `getAsientoDetalle`/motor. Ajustável pelo dono.

---

## PR-025a — TES-01 Bancos/Cajas ✅ (esta fatia)

### Mapa page → rota → serviço/action

| Rota | Page | Lê (read) | Muta (action, host/call verbatim) |
|---|---|---|---|
| `/tesoreria/cuentas` | `cuentas/page.tsx` | `listarCuentasBancariasWorklist(verSaldo)` (novo, read-only, saldo-gateado) + `listarCuentasContablesDisponibles` (existente) | `crearCuentaBancariaAction` (existente) via `NuevaCuentaWorkWindow` |
| `/tesoreria/movimientos` | `movimientos/page.tsx` | `db.movimientoTesoreria.findMany` (date-bounded) + `listarPrestamosPorCuentaContable` (existentes) | `anularAsientoAction` (existente) via diálogo; drill-down `getAsientoDetalle` (CALL) |

### Arquivos criados
- `src/lib/services/cuenta-bancaria-worklist.ts` — projeção read-only `listarCuentasBancariasWorklist(verSaldo)`. Narrow-select: sem permiso **não chama** `calcularSaldosCuentasBancariasEnMonedaCuenta` (motor intocado) e `saldo` sai `null`.
- `.../cuentas/cuentas-columns.tsx` — `buildCuentasColumns({ verSaldo, moneda, tc })`; coluna **Saldo** só existe se `verSaldo`.
- `.../cuentas/cuentas-worklist.tsx` — `EnterpriseDataGrid` (busca + chips tipo/moneda) + `NuevaCuentaButton`.
- `.../cuentas/nueva-cuenta-work-window.tsx` — **FWW** hospedando o form de criação + `DirtyFooter` + gate de descarte.
- `.../movimientos/movimientos-columns.tsx` — `buildMovimientosColumns({ moneda, tc, onOpenDetalle, onAnular })`; tipo `MovimientoWorklistRow`.
- `.../movimientos/movimientos-worklist.tsx` — `EnterpriseDataGrid` + diálogo de anular + FWW de detalhe.
- `.../movimientos/movimiento-detalle-work-window.tsx` — **FWW** read-only (body verbatim do sheet).
- `test/cuenta-bancaria-worklist.test.ts` — gate narrow-select da projeção.

### Arquivos modificados (aditivo, comportamento intacto)
- `src/lib/permisos-catalog.ts` — `VER_SALDO` em `PERMISOS` + entrada `CAMPO` no `PERMISSION_CATALOG` + `USER_BASE_CLAVES`.
- `src/lib/permisos-masking.ts` — helper `puedeVerSaldo()`.
- `.../cuentas/page.tsx` — resolve `verSaldo`, chama a projeção, renderiza `CuentasWorklist`.
- `.../movimientos/page.tsx` — mapeia `MovimientoWorklistRow`, renderiza `MovimientosWorklist` (mantém `DateRangeFilter`+`MonedaToggle`; filtros tipo/cuenta + paginação passam ao grid).
- `test/permisos-masking.test.ts` — `puedeVerSaldo` + `VER_SALDO` no invariante BASE.

### Drawer → FloatingWorkWindow (prova "mesmo body/action")

| Drawer (Sheet) | FWW nova | Body | Action (verbatim) |
|---|---|---|---|
| `cuentas/nueva-cuenta-sheet.tsx` | `nueva-cuenta-work-window.tsx` | mesmo schema Zod + campos + defaults | `crearCuentaBancariaAction({ banco, tipo, moneda, numero, cbu, alias, cuentaContableId: crearCuentaAuto ? null : cuentaContableId })` — **payload byte-idêntico** |
| `movimientos/movimiento-detalle-sheet.tsx` | `movimiento-detalle-work-window.tsx` | read-only; mesmas seções + `getAsientoDetalle` | — (só CALL de `getAsientoDetalle`) |

Só troca o container (`Sheet` → `FloatingWorkWindow`). Os drawers antigos (`cuentas-table.tsx`,
`nueva-cuenta-sheet.tsx`, `movimientos-table.tsx`, `movimiento-detalle-sheet.tsx`, `movimientos-filters.tsx`)
foram **mantidos** (não importados) como caminho de rollback — remover em cleanup pós-validação, ou
rollback = `git revert` da fatia.

### Prova de masking server-side
`listarCuentasBancariasWorklist(false)` **não** calcula saldo (motor não é chamado) e retorna
`saldo: null` em todas as linhas → o valor nunca chega ao cliente (não "—"). A coluna Saldo é
omitida no `buildCuentasColumns` sem `verSaldo`. FE (`PermissionGate`/máscara) seria só reflexo.
Coberto por `test/cuenta-bancaria-worklist.test.ts`.

### Auditoria de leitura sensível / export — DEFERIDO
Export día/auditado por worklist é **opcional (graceful-degrade)** no roadmap. A auditoria de
leitura sensível de saldos é o egress natural do **export** (`auditarExportacion`) — para evitar
spam de auditoria a cada page-load (`force-dynamic`), NÃO se audita cada render. Fica DEFERIDO junto
com o export (gateado por `VER_SALDO`, sem chave nova), a decidir pelo dono. O controle substantivo
(omissão server-side do saldo) está entregue.

### Behavior-preserving / motor intocado
- `crearCuentaBancariaAction` recebe payload byte-idêntico; `anularAsientoAction` e `getAsientoDetalle` são chamados verbatim.
- Nenhum motor tocado: `saldo-usd-nativo`, `cuenta-bancaria` (`calcularSaldos…` só é chamado), `movimientos-tesoreria`, `pago-exterior`, asiento/contabilización.
- `movimiento → asiento` inalterado (a UI só hospeda actions existentes) — validar com `db:validar-asientos`.

### Nota de migração (movimientos)
Filtros `tipo`/`cuenta` (antes URL via `MovimientosFilters`) e paginação (antes server via
`Pagination`) passaram para o `EnterpriseDataGrid` (chips + paginação client). `DateRangeFilter`
(bound server) + `MonedaToggle` permanecem na URL. Dado exibido = mesmo conjunto date-bounded.

### Validações (resultados)
- `pnpm prisma generate`: ✅ (Prisma Client 7.8.0).
- `pnpm typecheck`: ✅ (0 erros).
- `pnpm build`: ✅ (`/tesoreria/cuentas` e `/tesoreria/movimientos` compilam).
- `pnpm biome:ci`: ✅ exit 0 (43 warnings pré-existentes, 0 erros; meus arquivos formatados).
- `pnpm test`: ✅ **159 arquivos / 1221 testes** (inclui `cuenta-bancaria-worklist` + `permisos-masking` = 22).
- `db:validar-asientos` / `db:validar-stock`: **NÃO rodados** de propósito. O `DATABASE_URL` padrão
  aponta para **Railway/prod** (`shinkansen.proxy.rlwy.net`) → rodá-los seria tocar produção (STOP
  condition). Um DB descartável só validaria seed (já coberto pela suíte Testcontainers, ex.
  `asiento-despacho-cruzado`). **Prova de motor intocado**: `git diff --name-only` só lista UI +
  catálogo/masking + teste; zero diff no motor de asiento/`movimientos-tesoreria`/`pago-exterior`/
  `saldo-usd-nativo`/schema/seed/auth. A geração `movimiento → asiento` é byte-idêntica.

### Rollback
Reverter `cuentas/page.tsx` e `movimientos/page.tsx` aos componentes `*-table.tsx`/`*-sheet.tsx`
(mantidos), ou `git revert` da fatia. A chave `VER_SALDO` é aditiva e inerte com RBAC OFF.

---

## PR-025b / PR-025c — PENDENTES (não nesta fatia)
Reusam `VER_SALDO`/`puedeVerSaldo`. b: CxP + pagos-historial + saldos-proveedores (conservador) +
`anticipo-detalle`/`prestamo-detalle` → FWW. c: cuentas-a-cobrar (conservador) + FWW.
