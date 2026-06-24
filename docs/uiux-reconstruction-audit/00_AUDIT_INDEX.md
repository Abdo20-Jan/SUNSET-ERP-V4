# 00 — Índice da Auditoria UI/UX (SUNSET ERP v4)

> **Sessão AUDIT-ONLY.** Nenhum arquivo de código-fonte da aplicação foi modificado. Estes documentos comparam o repositório `sunset-erp-v4` contra a **baseline canônica Obsidian** (UI/UX congelada em 2026-06-23, 41 fichas + OD-01..OD-15) e produzem um plano mestre de implementação por PRs pequenos.

## Fonte de verdade (baseline)
`/Users/abdolatif/Documents/sunset-tires-brain/SUNSET TIRES CORPORATION SAS/SUNSET ERP/reconstrução UI UX/`
- `reports/BASELINE_LOCK.md` — o que está congelado.
- `reports/OWNER_DECISIONS_APPLIED.md` — OD-01..OD-15.
- `03_GLOBAL_NON_NEGOTIABLE_RULES.md` — G-01..G-10 + OD-13/14/15.
- `reports/CRITICAL_RULES_INVENTORY.md` — CRIT-01..14.
- `05_WORKLIST_PATTERN.md` / `06_RECORD_PATTERN.md` — padrões PAGE-STD-01/02.
- `12_COMPONENT_CATALOG.md` — componentes canônicos.
- `14_PAGE_CATALOG.md` + `reports/PAGE_CODE_INVENTORY.md` — as 41 páginas.

## Documentos gerados nesta auditoria

| # | Documento | Conteúdo |
|---|-----------|----------|
| 00 | [00_AUDIT_INDEX.md](00_AUDIT_INDEX.md) | Este índice. |
| 01 | [01_REPOSITORY_MAP.md](01_REPOSITORY_MAP.md) | Framework, gerenciador, comandos, estrutura de pastas, rotas, API, ORM, tema, testes, configs. |
| 02 | [02_CURRENT_ROUTE_PAGE_INVENTORY.md](02_CURRENT_ROUTE_PAGE_INVENTORY.md) | Inventário de rotas/páginas atuais × page_code canônico + confiança de match. |
| 03 | [03_CURRENT_COMPONENT_INVENTORY.md](03_CURRENT_COMPONENT_INVENTORY.md) | Componentes atuais: reuso, refactor, substituir por componente canônico, risco. |
| 04 | [04_UIUX_GAP_MATRIX.md](04_UIUX_GAP_MATRIX.md) | Regras/componentes canônicos × estado atual × gap × severidade × ação. |
| 05 | [05_PAGE_GAP_MATRIX.md](05_PAGE_GAP_MATRIX.md) | As 41 páginas canônicas × rota atual × status × itens faltantes × PR. |
| 06 | [06_PERMISSION_AUDIT.md](06_PERMISSION_AUDIT.md) | Mecanismos de permissão atuais, gates FE/BE, campo/export/leitura sensível, gaps. |
| 07 | [07_AUDIT_HISTORY_AUDIT.md](07_AUDIT_HISTORY_AUDIT.md) | Modelo/serviço de auditoria, antes/depois, motivo, origem, leitura sensível, gaps. |
| 08 | [08_BUSINESS_LOGIC_PROTECTION_MAP.md](08_BUSINESS_LOGIC_PROTECTION_MAP.md) | Zonas protegidas (rateio Comex, margem, valoração, motor contábil, USD), do-not-touch. |
| 09 | [09_TESTING_QA_AUDIT.md](09_TESTING_QA_AUDIT.md) | Lint/typecheck/build, unit/e2e, gaps, testes mínimos por PR, golden Comex. |
| 10 | [10_PR_ROADMAP.md](10_PR_ROADMAP.md) | Roadmap de PRs pequenos (PR-001..PR-0NN) com escopo/risco/aceite/rollback. |
| 11 | [11_PR001_DESIGN_FOUNDATION_PLAN.md](11_PR001_DESIGN_FOUNDATION_PLAN.md) | Plano detalhado SOMENTE do primeiro PR (Design Foundation). Não implementado. |
| 12 | [12_TRACEABILITY_MATRIX_AUDITED.md](12_TRACEABILITY_MATRIX_AUDITED.md) | Matriz semente → auditada (req × código atual × gap × severidade × PR × teste). |
| 13 | [13_OPEN_QUESTIONS_FOR_OWNER.md](13_OPEN_QUESTIONS_FOR_OWNER.md) | Questões que bloqueiam implementação (não as resolvidas por OD-01..15). |
| — | [HANDOFF_CURRENT.md](HANDOFF_CURRENT.md) | Resumo, decisões, áreas protegidas, próxima ação e prompt do PR-001. |

## Veredito executivo (resumo)

O `sunset-erp-v4` é um ERP maduro e funcionalmente rico (Next.js 16 App Router, Prisma 7, ~94 rotas, ~80 testes), mas a sua **camada de UI/UX diverge estruturalmente** da baseline congelada em pontos não-negociáveis:

- 🔴 **G-02 violado** — navegação primária é **sidebar lateral** (`app-sidebar.tsx`); a baseline exige **top-nav textual hierárquico, sem sidebar principal**.
- 🔴 **G-04 violado** — formulários de negócio usam **drawers laterais (`Sheet`)** em Tesouraria e Contabilidade; a baseline proíbe drawers e exige **FloatingWorkWindow**.
- 🔴 **G-06 / CRIT-10 incompleto** — permissão é só `Role` ADMIN/USER em `auth-guard.ts`; faltam os **12 perfis canônicos**, permissão de **campo/coluna/export/escopo** e o **`PermissionGate`** (FE) com guarda real no BE.
- 🔴 **G-07 / CRIT-11 incompleto** — `AuditLog` existe, mas **sem `motivo` nem `origen`**, e é gravado em pouquíssimos pontos; falta auditoria de **leitura sensível** e `AuditTimeline`.
- 🟠 **G-05 incompleto** — grids usam `@tanstack/react-table` + `data-table.tsx` básico; falta `EnterpriseDataGrid` (freeze, views salvas, export auditado, menu de contexto, expand).
- 🟢 **G-09 preservado** — motor de rateio Comex (`despacho-parcial.ts`, `contenedor.ts`) existe e **não deve ser tocado**; UI apenas exibe melhor.
- 🟡 **G-10 parcial** — `venta-form.tsx` calcula margem/custo, mas a **renderização condicional por permissão** (CRIT-01/02) precisa ser auditada/implementada.

**Conclusão:** o trabalho é uma **reconstrução de camada de apresentação** (fundação de design → shell → grid → record pattern → permissão/auditoria → módulos), preservando 100% do backend e dos motores de cálculo. Detalhe e sequência em [10_PR_ROADMAP.md](10_PR_ROADMAP.md).
