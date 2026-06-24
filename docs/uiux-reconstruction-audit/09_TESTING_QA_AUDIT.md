# 09 — Auditoria de Testes / QA

## Comandos existentes

| Tipo | Comando | Detalhe |
|---|---|---|
| Lint | `pnpm lint` · `pnpm biome:check` · `pnpm biome:ci` | ESLint (next) + Biome (100 col) |
| Typecheck | `pnpm typecheck` | `tsc --noEmit` (strict) |
| Build | `pnpm build` | `next build --turbopack` |
| Unit/integração | `pnpm test` (`vitest run`) · `pnpm test:watch` | Testcontainers Postgres por suite |
| E2E | `pnpm test:e2e` | Playwright **service-level** (sem browser), serial, Docker |

> ⚠️ `vitest run` **não** roda os e2e. Após mexer em Comex/contábil, rodar `pnpm test:e2e` (memória de projeto).

## Cobertura atual

### Unit / integração (Vitest) — ~80 specs em [test/](../../test/)
Forte no **backend/regras de negócio**:
- **Comex/rateio:** `costo-landed-despacho`, `despacho-parcial`, `despachos-fork`, `capitaliza-vs-gasto`, `crear-costo-despacho-cruzado`, `despacho-cruzado-capitalizacion-stock`, `anular-despacho-cruzado`, `cerrar-costos-contenedor`, `validar-invariantes-comex`, `arribo-comex`, `comex-revertir-zp-guard`, `comex-despacho-cruzado-guard`.
- **Container/desconsolidação/D9:** `contenedor`, `contenedores-actions`, `avanzar-estado-contenedor`, `revertir-estado-contenedor`, `desconsolidacion`, `divergencia-investigacion`, `divergencia-actions`, `itemdespacho-constraint`.
- **Stock/CMV:** `stock-recalc-replay`, `stock-replay-transferencia`, `stock-aduanero-segmentado`, `compra-estoque`, `backfill-cmv`, `cmv-puente-entrega-cierre`, `anular-transferencia-recalc`, `transferencia-bloquea-zona-primaria`.
- **Contábil/plano/balance:** `plan-de-cuentas`, `guard-registry-plan`, `cuenta-naturaleza`, `balance-naturaleza-regularizadora`, `balance-rubro-eecc`, `balance-reclasificar-saldos-a-favor`, `balance-sumas-saldos-usd`, `anular-asiento-guard`, `periodos-admin-guard`, `estado-resultados-rt9`, `salud-balancete(-loader)`.
- **Moeda/USD:** `diferencia-cambiaria-fase2/intermediario/multi`, `revaluacion`, `saldos-exterior-usd`, `guard-tipocambio-usd`, `tesoreria-usd-libro-ars`.
- **Tesouraria/fiscal:** `anticipo-proveedor-*`, `pago-exterior-action`, `retencion-ganancias(-pago/-manual)`, `gasto-deducible-ganancias`, `percepcion-iibb`(via actions), `extracto-aprobar-linea-tc`, `vep-despacho-action`.
- **Ventas/entregas:** `venta-split-categoria`, `venta-costo-cero-guard`, `venta-flete-gasto`, `entrega-borrador`, `entrega-valida-venta-emitida`, `entregas-pendientes(-loader)`, `entrega-stockactual-agregado`.
- **Auth/infra:** `auth-guard`, `auth-config-authorized`, `cron-cleanup-borrador`, `smoke`.

### E2E (Playwright) — 5 specs em [e2e/](../../e2e/)
`01-desconsolidacion-happy-path`, `02-anulacion-preservativa`, `03-despacho-parcial-doble`, `04-divergencia-d9`, `05-concurrencia-single-shot`. **São service-level** (exercitam actions contra Postgres efêmero), validam invariantes transacionais — **não exercitam UI/browser**.

## Gaps de teste

| gap | impacto |
|---|---|
| **Sem testes de UI/componente** (RTL/render) | nenhuma garantia de worklist/record/grid |
| **Sem e2e de browser** (Playwright real) | navegação, top-nav, FloatingWorkWindow, grid não cobertos |
| **Sem testes visuais/snapshot** (densidade, 28-30 linhas/1080p) | regressão visual não detectada |
| **Sem testes de permissão de campo/coluna/export** | vazamento de custo/margem não detectado (CRIT-02) |
| **Sem golden files de rateio Comex** dedicados a "antes de UI" | CRIT-05 não satisfeito p/ CX-05/06 |
| **Sem teste de auditoria antes/depois com motivo** | G-07/CRIT-11 não verificado |

## Testes mínimos por PR (gate)
Cada PR deve manter verde: `pnpm typecheck`, `pnpm biome:ci`, `pnpm lint`, `pnpm build`, `pnpm test`. PRs que tocam Comex/contábil/stock também: `pnpm test:e2e`.

| PR | teste mínimo adicional |
|---|---|
| PR-001 Design Foundation | snapshot de tokens; build; sem regressão visual em página piloto |
| PR-002 Shell/Top-nav | e2e browser: navegar por top-nav; abrir/fechar abas internas |
| PR-003 EnterpriseDataGrid | e2e: freeze de coluna, filtro, view salva, export auditado |
| PR-004 Record/FloatingWorkWindow | e2e: abrir/mover/maximizar/fechar FWW; DirtyFooter pede confirmação |
| PR-005 Permissão+Auditoria | **permissão FE+BE** (vendedor sem `ver_margen` não recebe valor); **auditoria antes/depois com motivo** |
| PR-006..010 Comercial | margem item+total %/valor por permissão; coluna **oculta** (não `—`); autorização margem baixa |
| Comex (CX-05/06) | **golden files (CRIT-05) ANTES**; `validar-invariantes-comex` + e2e Comex verdes |
| Finanças/Tesouraria | separação Finanças×Tesouraria; export auditado; USD ao TC fechamento |
| Contabilidade | asientos/balance inalterados; refs registry ULTRA |

## Golden tests de Comex (obrigatório antes de CX-06 UI — CRIT-05)
Antes de qualquer PR na UI de custos, criar **golden files** que congelam, para casos de referência:
1. memória de cálculo (bases, %, alocação, ajuste de arredondamento);
2. custo contábil (sem IVA) e gerencial (com IVA);
3. asiento gerado (linhas/contas/valores);
4. entrada de estoque (custo unitário por item).
Critério: a UI **não altera** nenhum desses outputs (diff zero). Reaproveitar `costo-landed-despacho`/`despacho-parcial`/`validar-invariantes-comex` como ponto de partida e fixar snapshots dedicados.
