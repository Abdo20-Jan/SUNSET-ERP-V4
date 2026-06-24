# HANDOFF — Auditoria UI/UX (SUNSET ERP v4)

> Leia este arquivo primeiro ao retomar.

## 0. Estado atual — PR-001 Design Foundation IMPLEMENTADO (2026-06-23, não commitado)
Após a auditoria, o **PR-001 (Design Foundation)** foi implementado e validado. Detalhe em [IMPLEMENTATION_NOTES_PR001.md](IMPLEMENTATION_NOTES_PR001.md) e guia de consumo em [DESIGN_FOUNDATION.md](DESIGN_FOUNDATION.md).
- **Entregue (aditivo, opt-in):** tokens de cor semântica (`success/warning/info/process`, light+dark) e de densidade (linha 32px/cabeçalho 34px) em [globals.css](../../src/app/globals.css); utilitários `.table-dense`/`.table-zebra`; `StatusBadge` + `SeverityBadge`; props opt-in `density`/`zebra` no `DataTable`; **piloto** `/maestros/productos`.
- **Validação:** `typecheck` ✅ (após limpar cache `.next` obsoleto), `biome:ci` ✅ (warnings só pré-existentes), `eslint` nos arquivos do PR-001 ✅ (0 erros), `build` ✅ exit 0. `pnpm test` ⚠️ **não executável aqui (Docker indisponível)** — reexecutar com Docker antes do merge; PR-001 não toca lógica testada.
- **Escopo do diff:** 3 arquivos editados (`globals.css`, `data-table.tsx`, `productos-table.tsx`) + 2 componentes novos + docs. Nada de `prisma/`, `lib/`, auth, rotas, nav, `button.tsx`, `money-amount.tsx`. **Não commitado.**
- **Próximo:** **PR-002 (Global Shell / Top-Nav / Internal Tabs)** — ver [10_PR_ROADMAP.md](10_PR_ROADMAP.md). Atenção: `pnpm lint` (eslint do repo inteiro) está vermelho no baseline (pré-existente) — tratar em PR de higiene à parte.

---

> Abaixo: handoff da sessão **AUDIT-ONLY** original (nenhum código tocado naquela fase; só documentos).

## 1. O que foi auditado
- **Baseline canônica** (Obsidian, congelada 2026-06-23): 41 fichas de página, OD-01..OD-15, G-01..G-10, CRIT-01..14, padrões PAGE-STD-01/02, design system, catálogo de componentes, permissões/auditoria, regra de margem, rateio Comex intocável, QA/risco.
- **Repositório `sunset-erp-v4`:** framework (Next.js 16 App Router, Prisma 7, pnpm), ~94 rotas, shell/navegação, componentes (shadcn `base-maia`), camada de permissão (`auth-guard.ts`), auditoria (`AuditLog`), ~44 serviços de negócio, ~80 testes Vitest + 5 e2e Playwright.

## 2. Arquivos criados (15)
`00_AUDIT_INDEX` · `01_REPOSITORY_MAP` · `02_CURRENT_ROUTE_PAGE_INVENTORY` · `03_CURRENT_COMPONENT_INVENTORY` · `04_UIUX_GAP_MATRIX` · `05_PAGE_GAP_MATRIX` · `06_PERMISSION_AUDIT` · `07_AUDIT_HISTORY_AUDIT` · `08_BUSINESS_LOGIC_PROTECTION_MAP` · `09_TESTING_QA_AUDIT` · `10_PR_ROADMAP` · `11_PR001_DESIGN_FOUNDATION_PLAN` · `12_TRACEABILITY_MATRIX_AUDITED` · `13_OPEN_QUESTIONS_FOR_OWNER` · `HANDOFF_CURRENT`.

## 3. Achados-chave (gaps não-negociáveis)
- 🔴 **G-02** — navegação é **sidebar lateral**; baseline exige **top-nav textual**. → PR-002.
- 🔴 **G-04** — **drawers (`Sheet`)** em 5 fluxos de negócio (Tesouraria×4, Asientos); baseline exige **FloatingWorkWindow**. → PR-004 + PRs de módulo.
- 🔴 **G-06/CRIT-10** — permissão só `Role` ADMIN/USER; faltam 12 perfis, permissão de campo/coluna/export/escopo e `PermissionGate`. → PR-005.
- 🔴 **G-07/CRIT-11** — `AuditLog` sem `motivo`/`origen`, gravado em só 3 pontos; sem `AuditTimeline` nem auditoria de leitura sensível. → PR-005.
- 🟠 **G-05** — grid básico; falta `EnterpriseDataGrid`. → PR-003.
- 🟠 **G-10/CRIT-01/02** — margem calculada em `venta-form` mas sem gating por permissão. → PR-005/007.
- **7 páginas ausentes:** COM-05, CLI-02, FIN-03, FIN-04, PERM-01, AUD-01, AUTO-01.

## 4. Áreas protegidas (NÃO TOCAR — só consumir via UI)
Motor de **rateio Comex** (`despacho-parcial.ts`, `contenedor.ts`, `comex.ts`), **margem/CMV** (`stock.ts`, `backfill-cmv.ts`, `asiento-automatico.ts`), **valoração de estoque** (`stock-recalc.ts`), **motor contábil/registry ULTRA** (`asiento-automatico.ts`, `cuenta-registry.ts`, `plan-de-cuentas.ts`), **tesouraria/finanças**, **moeda/USD** (`reportes/revaluacion.ts`), **auth** (estender, não substituir). Detalhe e testes de proteção em [08_BUSINESS_LOGIC_PROTECTION_MAP.md](08_BUSINESS_LOGIC_PROTECTION_MAP.md). **Golden files Comex (CRIT-05) obrigatórios antes de qualquer UI de custo.**

## 5. Bloqueios para o dono (antes de implementar)
Ver [13_OPEN_QUESTIONS_FOR_OWNER.md](13_OPEN_QUESTIONS_FOR_OWNER.md): (Q1) modelo de permissão, (Q2) extensão do `AuditLog` — ambos tocam schema/sessão; (Q3) estratégia de corte da navegação; (Q4) escopo das 7 páginas ausentes; (Q5) realocação Finanças/Tesouraria e COM-04; (Q6) casos de referência dos golden Comex; (Q7) **TES-03 Cobranzas Q&A detalhado incompleto (B1)** — bloqueia só o Q&A de TES-03.

## 6. Próxima ação recomendada
1. Resolver Q1/Q2 com o dono (permissão + auditoria — desbloqueia PR-005).
2. Iniciar **PR-001 (Design Foundation)** em Plan Mode — é seguro (cosmético) e não depende dos bloqueios. Ver [11_PR001_DESIGN_FOUNDATION_PLAN.md](11_PR001_DESIGN_FOUNDATION_PLAN.md).
3. Em paralelo, designar os casos de golden Comex (Q6) para destravar PR-COMEX no futuro.

## 7. Prompt exato para abrir o PR-001 (Plan Mode)
```
SUNSET ERP — PR-001 Design Foundation. INICIE EM PLAN MODE; não implemente ainda.
Leia: docs/uiux-reconstruction-audit/11_PR001_DESIGN_FOUNDATION_PLAN.md,
04_DESIGN_SYSTEM.md e 03_GLOBAL_NON_NEGOTIABLE_RULES.md da baseline.
Objetivo: adicionar tokens de densidade corporativa (linha 32px, cabeçalho 34px,
fonte 13px, números tabulares) em src/app/globals.css + config de estilo + primitivos
ui/table e ui/money-amount, e provar 28-30 linhas/1080p em UMA página piloto
(ex.: /contabilidad/asientos ou /inventario).
NON-GOALS: não tocar navegação, grid, FloatingWorkWindow, permissão, auditoria,
nenhuma server action/serviço/schema/cálculo. Só estilo + piloto.
Validação: pnpm typecheck && pnpm biome:ci && pnpm lint && pnpm build && pnpm test
(todos verdes; diff restrito a globals.css, config de estilo, ui/ e o piloto).
Entregue: plano de arquivos afetados, riscos, screenshots antes/depois e checklist
de aceite. Pare após o plano; aguarde aprovação para implementar.
```

## 8. Validação desta sessão
- `git status` deve mostrar **apenas** arquivos novos sob `docs/uiux-reconstruction-audit/`.
- Nenhum arquivo de aplicação (`src/`, `prisma/`, configs) modificado. Nenhum commit feito.
