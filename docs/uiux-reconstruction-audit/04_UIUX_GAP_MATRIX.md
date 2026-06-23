# 04 — Matriz de Gaps UI/UX (atual × baseline)

> Comparação das regras globais (G-01..G-10), Design System, padrões PAGE-STD-01/02 e componentes-base contra o estado atual do `sunset-erp-v4`. Severidade: 🔴 crítica (não-negociável violado) · 🟠 alta · 🟡 média · 🟢 ok.

## Regras Globais (G-01..G-10)

| regra/componente | requisito baseline | estado atual | gap | sev. | arquivos afetados | ação recomendada | teste |
|---|---|---|---|---|---|---|---|
| **G-01** densidade | Desktop-first, densidade alta, baixo brilho, corporativo; linha 32px, fonte 13px, 28-30 linhas/1080p | Tema warm-light OK; densidade/linha não tokenizadas | Tokens de densidade ausentes; tabelas não garantem 28-30 linhas | 🟡 | `globals.css`, `ui/table`, `data-table` | Tokens de densidade + grid denso | visual 1080p (28-30 linhas) |
| **G-02** navegação | **Top-nav textual hierárquico; sem sidebar principal** | **Sidebar lateral** (`AppSidebar`) | Padrão de navegação errado | 🔴 | `(dashboard)/layout.tsx`, `app-sidebar`, `nav-items.ts` | `AppShell` + `ModuleMegaMenu` (top) + `InternalTabs` | e2e navegação por top-nav |
| **G-03** ações com texto | Botões importantes com texto completo; ícone só reforço | Mistura; nav e várias ações por ícone | Ações icon-only em pontos | 🟠 | layout, toolbars de página | Padronizar botões com texto | lint visual/checklist |
| **G-04** sem drawers | **Sem drawers de negócio; usar FloatingWorkWindow** | **`Sheet` (drawer) em 5 fluxos** + `Dialog` | Drawers de negócio | 🔴 | `*-detalle-sheet.tsx` (tesoreria×4, asientos) | Criar `FloatingWorkWindow` e migrar | e2e abrir/mover/fechar form |
| **G-05** worklists | Colunas congeladas, busca, filtros, views salvas, export, drill-down, ações contextuais | `data-table` básico (tanstack); sem freeze/views/export auditado/ctx-menu | Grid incompleto | 🟠 | `ui/data-table`, listas de cada módulo | `EnterpriseDataGrid` | e2e grid (freeze/filter/export) |
| **G-06** permissão | Tudo por permissão (módulo/página/ação/campo/info/doc/relatório/export/escopo) FE **e** BE | Só Role ADMIN/USER (`auth-guard`) | Sem campo/coluna/export/escopo/12 perfis/`PermissionGate` | 🔴 | `auth.config.ts`, `auth-guard.ts`, schema | Modelo de permissão + `PermissionGate` + guards BE | testes de permissão FE+BE |
| **G-07** auditoria | Antes/depois + usuário + data/hora + **motivo** + **origem**, imutável | `AuditLog` sem `motivo`/`origen`; escrito em ~3 pontos | Campos e cobertura faltando; sem leitura sensível; sem UI | 🔴 | `schema.prisma` (AuditLog), services/actions | Estender `AuditLog` + serviço central + `AuditTimeline` | teste evento antes/depois |
| **G-08** BI separado | BI concentra KPIs; operacional não vira dashboard | `/bi` existe; revisar dashboards operacionais | Risco de KPI em operacional | 🟡 | `/bi`, `/dashboard`, páginas op. | Manter KPIs rápidos só onde necessário | revisão de design |
| **G-09** Comex rateio | **Não reimplementar motor**; UI só exibe melhor | Motor existe e funciona | — (preservar) | 🟢 | `despacho-parcial.ts`, `contenedor.ts`, `comex.ts` | **Não tocar**; golden tests antes de UI de custo | golden Comex (CRIT-05) |
| **G-10** margem | Margem por item+total, %/valor, oculta a vendedor sem permissão | `venta-form` calcula; permissão não confirmada | Renderização condicional por permissão | 🟠 | `venta-form.tsx`, grids comerciais | Coluna margem via `PermissionGate` (ocultar, não `—`) | teste vendedor sem permissão |

## Design System (04)

| item | baseline | atual | gap | sev. |
|---|---|---|---|---|
| Paleta | NetSuite neutra; cor forte só p/ alerta | warm-light OK | alinhar realces de alerta | 🟢 |
| Densidade | linha 32px / fonte 13px / cabeçalho 34px | não tokenizado | criar tokens | 🟡 |
| Tipografia | tabular/monospace p/ números/valores | Geist Mono disponível | aplicar em MoneyCell/grids | 🟡 |
| Tabelas | zebra, bordas finas, sticky, freeze, resize, filtros, export | parcial | completar no grid | 🟠 |
| Ações destrutivas | confirmação + **motivo** | parcial (alguns têm motivo) | padronizar motivo obrigatório | 🟠 |
| Alertas | severidade por cor sem pintar tela; causa/responsável/status/link | ad-hoc | `AlertPopover`/`SeverityBadge` | 🟡 |

## Padrão de Worklist (PAGE-STD-01)

| elemento | baseline | atual | gap | sev. |
|---|---|---|---|---|
| Ordem fixa (breadcrumb→ações→busca→filtros→views→grid→resumo seleção→paginação) | obrigatória | divergente por página | padronizar layout | 🟠 |
| 1ª col = id técnico c/ prefixo (`V-000142`…) congelada | obrigatória | varia | normalizar | 🟡 |
| 2ª col = entidade (`EntityLink`+chevron) congelada | obrigatória | sem EntityLink | criar | 🟠 |
| Status sempre congelado (`StatusBadge`, etapa menos avançada) | obrigatória | parcial | normalizar | 🟡 |
| Views salvas (oficiais/pessoais/recentes) | obrigatória | ❌ | `SavedViewsBar` | 🟠 |
| Export auditado (`export_excel`/`export_full`) | obrigatória | ❌ | permissão + auditoria | 🔴 (liga G-06/07) |
| Ações em massa classificadas (segura/moderada/arriscada + motivo) | obrigatória | parcial | padronizar | 🟠 |
| Menu de contexto por linha | obrigatória | ❌ | adicionar | 🟡 |

## Padrão de Registro (PAGE-STD-02)

| elemento | baseline | atual | gap | sev. |
|---|---|---|---|---|
| `AdaptiveRecordHeader` 3 linhas + 7 campos obrigatórios | obrigatória | header ad-hoc | criar | 🟠 |
| ActionBar sticky + **DirtyFooter** | obrigatória | parcial | criar `DirtyFooter` | 🟠 |
| 1ª aba `Resumen`, última `Historial/Auditoría` | obrigatória | varia | normalizar | 🟠 |
| Aba `Documentos` + mini-card no Resumen | obrigatória | parcial | normalizar | 🟡 |
| Faixa de alertas ativos no topo | obrigatória | ad-hoc | `AlertPopover` | 🟡 |
| Cancelamento exige **motivo** + dupla confirmação | obrigatória | parcial | padronizar | 🟠 |
| Reabertura: motivo + permissão superior + (crítico) dupla aprovação | obrigatória | parcial | workflow | 🟠 |
| Campos calculados com ícone `fx` (memória de cálculo) | obrigatória | ❌ | `MemoriaCalculoWindow` (Comex) | 🟡 |
| `DualCurrencyAmount` ARS+USD | obrigatória | `money-amount` parcial | estender | 🟡 |

## Componentes-base ausentes (12_COMPONENT_CATALOG)

`AppShell` · `ModuleMegaMenu` · `GlobalSearch` · `InternalTabs` · `AdaptiveRecordHeader` · `ActionBar` · `DirtyFooter` · **`EnterpriseDataGrid`** · **`FloatingWorkWindow`** · `EntityLink` · `StatusBadge`/`SeverityBadge` · `AlertPopover` · `AuditTimeline` · `DocumentViewer` · `MoneyCell`/`DualCurrencyAmount` · **`PermissionGate`** · `SavedViewsBar`/`FilterBar`/`AdvancedFilters` · `InlineValidationSummary`. → **Nenhum existe por nome**; são o núcleo dos PRs de fundação (PR-001..005).

## Top gaps a atacar primeiro (ordem)
1. 🔴 **G-06 permissão** (bloqueia Comercial/Financeiro/Comex com dado sensível).
2. 🔴 **G-07 auditoria** (estender `AuditLog` + serviço central).
3. 🔴 **G-04 FloatingWorkWindow** (remove drawers de negócio).
4. 🔴 **G-02 top-nav** (`AppShell`/`ModuleMegaMenu`).
5. 🟠 **G-05 EnterpriseDataGrid** + 🟠 **G-10 margem por permissão**.
