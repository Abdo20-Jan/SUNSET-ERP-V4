# 10 — Roadmap de PRs (pequenos, incrementais)

> Princípios: PRs pequenos, **fundação antes de módulos**, **permissão+auditoria antes de qualquer dado sensível**, **golden tests antes de UI de custo Comex**, backend/motores intocados. Cada PR mantém a suíte verde (ver [09_TESTING_QA_AUDIT.md](09_TESTING_QA_AUDIT.md)). Sequência derivada do ANEXO C da baseline.

## Fase 0 — Fundação (bloqueia tudo)

### PR-001 — Design Foundation
- **Escopo:** tokens de densidade/cor/tipografia (linha 32px, fonte 13px, cabeçalho 34px, tabular p/ números), paleta NetSuite neutra, baixo brilho; aplicar a 1 página piloto. Detalhe em [11_PR001_DESIGN_FOUNDATION_PLAN.md](11_PR001_DESIGN_FOUNDATION_PLAN.md).
- **Non-goals:** sem mudar navegação, sem grid novo, sem lógica.
- **Ler:** `04_DESIGN_SYSTEM.md`, `03_GLOBAL_NON_NEGOTIABLE_RULES.md`.
- **Áreas:** `globals.css`, config Tailwind, primitivos `ui/`.
- **Risco:** B. **Aceite:** página piloto em densidade corporativa; build/lint verdes; sem regressão visual fora do piloto. **Rollback:** reverter tokens (sem efeito em dados).

### PR-002 — Global Shell / Top Navigation / Internal Tabs
- **Escopo:** `AppShell` + `ModuleMegaMenu` (top-nav textual hierárquico, **substitui sidebar como nav primária**), `InternalTabs` (abas internas multi com indicadores `!`/`*`/cadeado), breadcrumb. `GlobalSearch` básico.
- **Non-goals:** não remover sidebar do código ainda (feature-flag de nav); sem grids novos.
- **Ler:** SHELL-01, SEARCH-01, `03` (G-02/G-03), `12_COMPONENT_CATALOG`.
- **Áreas:** `(dashboard)/layout.tsx`, `components/layout/*`, `nav-items.ts`.
- **Risco:** M (toca shell de todas as páginas). **Aceite:** navegação por top-nav; abas internas abrem/fecham com confirmação em `*`; e2e browser de navegação. **Rollback:** flag volta ao sidebar.

### PR-003 — EnterpriseDataGrid / Worklist Infra
- **Escopo:** `EnterpriseDataGrid` (freeze, sort, filtros, `SavedViewsBar`, export, menu de contexto, expand) sobre `@tanstack/react-table`; `FilterBar`/`AdvancedFilters` (em FloatingWorkWindow); `EntityLink`+chevron; `StatusBadge`/`SeverityBadge`; resumo de seleção sticky.
- **Non-goals:** export **auditado** e permissão de coluna ficam para PR-005; aplicar a 1 worklist piloto.
- **Ler:** `05_WORKLIST_PATTERN`, `12_COMPONENT_CATALOG`.
- **Áreas:** `components/ui/data-table.tsx` → novo grid; piloto numa lista existente.
- **Risco:** M. **Aceite:** e2e grid (freeze/filtro/view/expand); densidade 28-30 linhas/1080p. **Rollback:** manter `data-table` antigo nas demais páginas.

### PR-004 — Record Pattern / FloatingWorkWindow / ActionBar / DirtyFooter
- **Escopo:** `FloatingWorkWindow` (central, movível, redimensionável, maximizável), `AdaptiveRecordHeader` (3 linhas + 7 campos), `ActionBar` sticky, `DirtyFooter`, abas `Resumen`/`Documentos`/`Historial`, `AlertPopover`, `DualCurrencyAmount`/`MoneyCell`.
- **Non-goals:** **migrar os 5 drawers de negócio** para FWW vem nos PRs de módulo (Tesouraria/Contabilidade); aqui só o componente + 1 piloto.
- **Ler:** `06_RECORD_PATTERN`, `12_COMPONENT_CATALOG`.
- **Áreas:** novos componentes em `components/ui/`; piloto.
- **Risco:** M. **Aceite:** e2e abrir/mover/maximizar/fechar FWW; DirtyFooter confirma descarte. **Rollback:** componente isolado; piloto reversível.

### PR-005 — PermissionGate + Audit Foundation 🔴 (bloqueante de dados sensíveis)
- **Escopo:** modelo de permissão (perfis/dimensões + flags `ver_costo`/`ver_margen`/`ver_saldo`/`ver_limite`/`export_excel`/`export_full` + escopo); `PermissionGate` (FE) + `requirePermission` (BE); estender `AuditLog` com `motivo`/`origen`/`documentoId`/`ip`; serviço central `registrarAuditoria`; `AuditTimeline` (UI).
- **Non-goals:** página PERM-01/AUD-01 completas (PRs próprios depois); não tocar guards existentes (estender).
- **Ler:** `07_PERMISSIONS_AUDIT_SECURITY`, `06_PERMISSION_AUDIT.md`, `07_AUDIT_HISTORY_AUDIT.md`, CRIT-10/11.
- **Áreas:** `prisma/schema.prisma` (migração — **requer aprovação**, ver [13](13_OPEN_QUESTIONS_FOR_OWNER.md)), `auth*`, novo `lib/permisos.ts`, novo `lib/services/auditoria.ts`, `components/PermissionGate`.
- **Risco:** **A** (schema + sessão). **Aceite:** vendedor sem `ver_margen` **não recebe** valor no payload; alteração sensível grava antes/depois+motivo; testes FE+BE. **Rollback:** migração reversível; flags default = comportamento atual.

## Fase 1 — Comercial (margem é crítica)

| PR | página | escopo | ler | risco | aceite-chave | rollback |
|---|---|---|---|---|---|---|
| PR-006 | **COM-01** Worklist | worklist unificada P/P/V, **4 colunas congeladas** (OD-01), views/export auditado | COM-01, `05` | M | 4 freeze; export auditado; coluna margem por permissão | flag de rota |
| PR-007 | **COM-02** Venta | record pattern; **margem item+total %/valor por permissão** (CRIT-01/02); autorização margem baixa (gancho) | COM-02, `08_SALES_MARGIN_RULES` | **A** | margem oculta p/ vendedor (não `—`); valores inalterados | reverter view |
| PR-008 | **COM-03** Pedido | **16 colunas** (OD-02); stock disp./post-doc; reservas | COM-03 | M | 16 colunas; reservas; margem por permissão | flag |
| PR-009 | **COM-04** Presupuesto | realocar p/ Comercial; **7 estados** (OD-03); margem | COM-04 | M | 7 estados; margem | flag |
| PR-010 | **COM-05** Autorizaciones | workflow de aprovação por faixas (CRIT-03); histórico | COM-05, `13_APPROVALS` | **A** | faixas −5/−10/−15; auditoria | desabilitar página |

## Fase 2 — Demais módulos (após fundação)

| PR | módulo / páginas | escopo-chave | ler | risco |
|---|---|---|---|---|
| PR-CLI | **CLI-01 Ficha Geral**, **CLI-02 Ficha Financeira** | ficha geral + financeira (saldo/limite por permissão) | CLI-01/02, `06` | A (sensível) |
| PR-PROD | **MAE-PROD-01** | record pattern; custo por permissão; import Excel/duplicidade | MAE-PROD-01 | M |
| PR-INV | **INV-01 (11 col)**, **INV-02 (12 col)**, **LOG-01** | worklists + custo por permissão; estoque por despacho/lote | INV-01/02, LOG-01, OD-04/05 | M |
| PR-COMEX | **CX-01..CX-07** | cockpit por **seção nomeada** (OD-08); `MemoriaCalculoWindow`; worklist/record. 🔴 **golden ANTES** (CRIT-05); motor intocável | CX-01..07, `09_COMEX_RATEIO_DO_NOT_TOUCH` | **A** |
| PR-FIN | **FIN-01..FIN-05** | CxC (11 col + Próxima acción), CxP, Crédito/Cobranza, Programação, Flujo; **Finanças programa** | FIN-01..05, OD-06 | A |
| PR-TES | **TES-01..TES-04** | Bancos/Pagos/Cobranzas/Conciliación; **migrar drawers→FWW**; Tesouraria executa | TES-01..04, OD-09 (TES-03 Q&A pendente) | M |
| PR-CONT | **CONT-01..CONT-04** | Asientos (+Período OD-07; drawer→FWW), Plan ULTRA, DRE e Balance **separados** (OD-12) | CONT-01..04, OD-07/12/14 | M |
| PR-COMP | **COMP-01 (+aba Recepción)** | OC + worklist; Recepción = aba (OD-11), **não** rota | COMP-01/02, OD-11 | M |
| PR-CRM | **CRM-01** | alinhar Kanban/leads/oportunidades ao record pattern | CRM-01 | B |
| PR-BI | **BI-01** | export Excel/PDF auditado; favoritos; **sem margem p/ vendedor** | BI-01, G-08/G-10 | M |
| PR-PERM | **PERM-01** | UI das 10 dimensões + 12 perfis; override/herança/simular/temporárias | PERM-01 | A |
| PR-AUD | **AUD-01** | UI de auditoria (9 campos, eventos, imutável) | AUD-01 | A |
| PR-AUTO | **AUTO-01** | matriz de aprovações + SLA + escalonamento | AUTO-01, `13_APPROVALS` | A |

## Regras transversais (todo PR)
- **Non-goals fixos:** não tocar motor de rateio/CMV/contábil/valoração/USD; não remover auditoria; não expor custo/margem/saldo sem permissão.
- **Acceptance fixo:** AppShell/top-nav; FloatingWorkWindow (sem drawer de negócio); botões com texto; permissão FE+BE; auditoria antes/depois com motivo; densidade 28-30 linhas; ARS/USD dual.
- **Tests fixos:** `typecheck`+`biome:ci`+`build`+`test` verdes; `test:e2e` quando tocar Comex/contábil/stock.
- **Rollback fixo:** preferir **feature-flag por página/nav**; migrações reversíveis; piloto antes de rollout.

---

## Continuação — Onda 2+ (pós-PR-012 · atualizado 2026-06-25)

> **Estado executado.** PR-001→005 (fundação) saíram pela série **NS-*** em `main`; PR-006→012
> (RBAC + auditoria + mascaramento + motor de aprovações) **mergeados** como Onda 0/1 — ver
> [IMPLEMENTATION_TRIAGE_2026-06-25.md](IMPLEMENTATION_TRIAGE_2026-06-25.md) e
> [12_TRACEABILITY_MATRIX_AUDITED.md](12_TRACEABILITY_MATRIX_AUDITED.md). A "Fase 2" acima
> (PR-CLI…PR-BI) é **renumerada como Onda 3** (PR-015+), porque PR-006→012 já foram consumidos.
> Legenda: tamanho S/M/L/XL · 🔶 toca schema/auth · ⛔ não tocar motor (UI só chama/expõe).

### Onda 2 — Aprovações ao vivo (desbloqueada por PR-012)

| PR | Título | Escopo | Depende | 🔶/⛔ | Risco | Tam |
|---|---|---|---|---|---|---|
| **PR-013** | **Central de Aprobaciones UI** (AUTO-01) | worklist `Sistema > Aprobaciones` (EnterpriseDataGrid) + bloco no Dashboard (contador + top-3 por SLA) + aba `Autorizaciones` no documento; ações `aprobar`/`rechazar`/`solicitarInformacion`/`cancelar`; export auditada. Consome `Solicitud`/`Aprobacion` + `getConfigAprobacion`. Chave `aprobaciones.ver`. | PR-010, PR-012 | — | M | L |
| **PR-014** | **Cabeamento margem baixa** (COM-05 / CRIT-03) | 1ª ação **gateada**: venda com margem < piso cria `Solicitud(MARGEN_BAJA_*)`; o efeito de negócio aplica-se **só** quando `estado=APROBADA`; **liga `APPROVALS_ENABLED`** (+ `RBAC_ENABLED` se preciso p/ a matriz de aprovadores). | PR-007, PR-012, PR-013 | ⛔ só gatear margem | **A** | L |

### Onda 3 — Módulos (a "Fase 2" renumerada)

| PR | Módulo / páginas | Escopo-chave | risco |
|---|---|---|---|
| **PR-015** | CLI-01/CLI-02 (PR-CLI) | ficha geral + financeira (saldo/limite por permissão — reusa `permisos-masking`) | A |
| **PR-016** | MAE-PROD-01 (PR-PROD) | record pattern; custo por permissão; import Excel/duplicidade | M |
| **PR-017** | INV-01/02 + LOG-01 (PR-INV) | worklists + custo por permissão; estoque por despacho/lote | M |
| **PR-018** | CX-01..07 (PR-COMEX) | 🔴 **golden ANTES** (CRIT-05); 🔒 motor intocável; cockpit por **seção nomeada** (OD-08); `MemoriaCalculoWindow` | **A** |
| **PR-019** | FIN-01..05 (PR-FIN) | CxC (11 col + Próxima acción), CxP, Crédito/Cobranza, Programação, Flujo | A |
| **PR-020** | TES-01..04 (PR-TES) | Bancos/Pagos/Cobranzas/Conciliación; **migrar drawers→FWW** | M |
| **PR-021** | CONT-01..04 (PR-CONT) | Asientos (+Período OD-07; drawer→FWW), Plan ULTRA, DRE e Balance **separados** (OD-12) | M |
| **PR-022** | COMP-01/02 (PR-COMP) | OC + worklist; Recepción = **aba** da OC (OD-11), não rota | M |
| **PR-023** | CRM-01 (PR-CRM) | alinhar Kanban/leads/oportunidades ao record pattern | B |
| **PR-024** | BI-01 (PR-BI) | export Excel/PDF auditado; favoritos; **sem margem p/ vendedor** | M |

### Dívidas transversais a encaixar nas ondas
- **Habilitar `RBAC_ENABLED`** em staging + Master atribui grants aos 11 perfis canônicos (shells vazios desde PR-009).
- **Migrar os 5 drawers de negócio → FloatingWorkWindow** (concentrado em PR-020/PR-021).
- **Golden files Comex** (CRIT-05) **antes** do PR-018.
- Escopo de dados **por-perfil** (ANEXO A.4) não modelado (`Perfil` sem `ambito`) — avaliar migration própria se exigido.
