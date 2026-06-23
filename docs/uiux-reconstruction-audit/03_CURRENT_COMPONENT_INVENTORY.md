# 03 — Inventário de Componentes Atuais

> Componentes atuais × decisão (reusar / refatorar / substituir por canônico / depreciar). `can_reuse`/`needs_refactor` = sim/não. `replace_with_canonical` aponta o componente da baseline ([12_COMPONENT_CATALOG.md](<../../../Documents>) → ver baseline). `risco`: alto = toca regra crítica/dado sensível.

## Layout / Shell

| componente | path | propósito | uso atual | reuse | refactor | substituir por canônico | risco |
|---|---|---|---|---|---|---|---|
| `AppSidebar` | [src/components/layout/app-sidebar.tsx](../../src/components/layout/app-sidebar.tsx) | Navegação primária lateral | Shell `(dashboard)` | ❌ | — | **`AppShell` + `ModuleMegaMenu` (top-nav)** | médio | 🔴 viola G-02; substituir como nav primária. |
| `AppHeader` | [src/components/layout/app-header.tsx](../../src/components/layout/app-header.tsx) | Topo (breadcrumb/user) | Shell | ✅ | sim | base do `AppShell` topo | médio |
| `nav-items.ts` | [src/components/layout/nav-items.ts](../../src/components/layout/nav-items.ts) | Definição de menus | NAV_GROUPS | ✅ | sim | fonte do `ModuleMegaMenu` | baixo |
| `breadcrumb` | [src/components/layout/breadcrumb.tsx](../../src/components/layout/breadcrumb.tsx) | Trilha | Header | ✅ | — | parte do AppShell | baixo |
| `user-menu` | [src/components/layout/user-menu.tsx](../../src/components/layout/user-menu.tsx) | Menu do usuário | Header | ✅ | — | — | baixo |
| `page-header` | [src/components/layout/page-header.tsx](../../src/components/layout/page-header.tsx) | Título de página | páginas | ✅ | sim | base de `AdaptiveRecordHeader`/título de worklist | baixo |
| `ui/sidebar` | [src/components/ui/sidebar.tsx](../../src/components/ui/sidebar.tsx) | Primitivo Radix sidebar | AppSidebar | ◐ | — | depreciar como nav principal (pode servir a sub-painéis) | médio |

## Grid / Worklist

| componente | path | propósito | uso atual | reuse | refactor | substituir por canônico | risco |
|---|---|---|---|---|---|---|---|
| `ui/data-table` | [src/components/ui/data-table.tsx](../../src/components/ui/data-table.tsx) | Tabela genérica (tanstack) | listas | ◐ | sim | **`EnterpriseDataGrid`** (freeze, views, export auditado, ctx-menu, expand) | médio |
| `ui/table` | [src/components/ui/table.tsx](../../src/components/ui/table.tsx) | Primitivo de tabela | data-table | ✅ | — | base do EnterpriseDataGrid | baixo |
| `ui/pagination`, `pagination-params` | src/components/ui/ | Paginação | listas | ✅ | sim | barra inferior do grid | baixo |

## Formulário / Record (drawers — gap G-04)

| componente | path | propósito | uso atual | reuse | refactor | substituir por canônico | risco |
|---|---|---|---|---|---|---|---|
| `*-detalle-sheet` (5×) | tesoreria/{anticipos,cuentas,movimientos,prestamos}, contabilidad/asientos | Form/detalhe em **drawer lateral** | edição de negócio | ❌ | — | **`FloatingWorkWindow`** | **alto** 🔴 viola G-04. |
| `ui/sheet` | [src/components/ui/sheet.tsx](../../src/components/ui/sheet.tsx) | Drawer lateral (Radix) | os sheets acima | ◐ | — | não usar em form de negócio | médio |
| `ui/dialog` | [src/components/ui/dialog.tsx](../../src/components/ui/dialog.tsx) | Modal (36 usos) | confirmações/forms | ◐ | sim | base de `FloatingWorkWindow` (movível/redim./maximizável) | médio |
| `venta-form` | [src/app/(dashboard)/ventas/_components/venta-form.tsx](<../../src/app/(dashboard)/ventas/_components/venta-form.tsx>) | Form de Venta + margem/custo | COM-02 | ✅ | sim | record pattern + `PermissionGate` na coluna margem | **alto** 🔴 CRIT-01/02. |
| `ui/money-amount` | [src/components/ui/money-amount.tsx](../../src/components/ui/money-amount.tsx) | Valor monetário | valores | ✅ | sim | base de `MoneyCell`/`DualCurrencyAmount` (ARS+USD) | baixo |
| `ui/retroactivo-badge`, `date-badge`, `badge` | src/components/ui/ | Badges | status/datas | ✅ | sim | base de `StatusBadge`/`SeverityBadge` | baixo |
| `ui/command` | [src/components/ui/command.tsx](../../src/components/ui/command.tsx) | Command palette (cmdk) | — | ✅ | sim | base de `GlobalSearch` | baixo |
| `ui/tabs` | [src/components/ui/tabs.tsx](../../src/components/ui/tabs.tsx) | Abas | páginas | ✅ | sim | base de `InternalTabs` (abas internas multi) | baixo |
| `ui/chart` (recharts) | [src/components/ui/chart.tsx](../../src/components/ui/chart.tsx) | Gráficos | BI | ✅ | — | `DrillDownChart` (apenas BI; G-08) | baixo |
| `form/field-error` | [src/components/form/field-error.tsx](../../src/components/form/field-error.tsx) | Erro de campo | forms | ✅ | sim | base de `InlineValidationSummary` | baixo |

## Permissão / Auditoria (faltam componentes)

| componente canônico | existe hoje? | observação |
|---|---|---|
| `PermissionGate` | ❌ | Só `auth-guard.ts` (Role ADMIN/USER, server). Criar wrapper FE + checagem BE — ver [06_PERMISSION_AUDIT.md](06_PERMISSION_AUDIT.md). |
| `AuditTimeline` | ❌ | `AuditLog` no schema, sem UI. Ver [07_AUDIT_HISTORY_AUDIT.md](07_AUDIT_HISTORY_AUDIT.md). |
| `MemoriaCalculoWindow` (Comex) | ❌ | Memória de rateio existe nos serviços; falta janela de exibição (CX-06, sem tocar motor). |
| `EntityLink` (+chevron), `SavedViewsBar`, `FilterBar`, `AdvancedFilters`, `AlertPopover`, `DocumentViewer`, `StatusBadge`, `SeverityBadge` | ❌ | Nenhum existe por nome; construir na fundação (PR-001..005). |

## Leitura

- Os **35 primitivos shadcn** são uma **boa base reutilizável** (button, input, select, dialog, tabs, table, badge, calendar, etc.) — a estratégia recomendada é **compor os componentes canônicos por cima** dos primitivos existentes, não reescrever do zero.
- **Maior dívida estrutural:** (1) nav lateral → top-nav; (2) drawers de negócio → `FloatingWorkWindow`; (3) `data-table` → `EnterpriseDataGrid`; (4) ausência de `PermissionGate`/`AuditTimeline`.
- **Catálogo canônico completo** (Base, Comercial, Comex, Inventário, Finanças, Contabilidade, Compras/CRM/BI) em `12_COMPONENT_CATALOG.md` da baseline — os nomes ali são o alvo de nomenclatura.
