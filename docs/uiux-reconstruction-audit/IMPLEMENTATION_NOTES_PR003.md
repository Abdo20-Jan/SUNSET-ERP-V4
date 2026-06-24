# IMPLEMENTATION NOTES — PR-003 EnterpriseDataGrid / Worklist Infrastructure

Data: 2026-06-23 · Branch: `pr-003-enterprise-datagrid` · **Não commitado.**

> Entrega a **infra reutilizável de Worklist** (G-05 / PAGE-STD-01): o `EnterpriseDataGrid` sobre `@tanstack/react-table` + toolbar, busca rápida, chips de filtro, visões salvas (in-memory), visibilidade de colunas, **colunas congeladas** (left-pin), ordenação, **seleção + rodapé sticky**, **expansão** (drill-down inline), paginação e `EntityLink`. Aplicada a **UM piloto seguro**: `/maestros/productos`. Tudo **aditivo** — o `ui/data-table.tsx` segue intacto servindo as outras 4 páginas. **Sem** lógica de negócio/cálculo/permissão/auditoria/schema/auth/rota. Consome a fundação do PR-001 (densidade/zebra/badges) e a do PR-002 (`useInternalTabs`).

## Decisões do dono (confirmadas em Plan Mode)
- **EntityLink ↔ abas internas:** **integrar** com acréscimo aditivo mínimo (hook `useInternalTabsOptional`) — EntityLink abre registro em aba quando `TOP_NAV_ENABLED=ON` e navega normal quando OFF.
- **Freeze de colunas:** **funcional no piloto** (left-pin via column pinning do TanStack + CSS sticky), cumprindo o item "freeze" do aceite do roadmap.

## Arquivos alterados

| arquivo | tipo | conteúdo |
|---|---|---|
| [src/components/data-grid/data-grid-helpers.ts](../../src/components/data-grid/data-grid-helpers.ts) | **novo** | augmentação de `ColumnMeta` (`align`/`width`/`pinned`/`label`) + tipos (`SavedView`/`QuickFilter`/`QuickSearchConfig`) + utils puros de filtragem |
| [src/components/data-grid/enterprise-data-grid.tsx](../../src/components/data-grid/enterprise-data-grid.tsx) | **novo** | orquestrador: monta o TanStack internamente (core+sorted+expanded+pagination), estados de sort/visibilidade/seleção/expand/pin/paginação, render denso, freeze sticky |
| [src/components/data-grid/worklist-toolbar.tsx](../../src/components/data-grid/worklist-toolbar.tsx) | **novo** | título + busca rápida (~50%) + `ColumnVisibility` + ação primária (texto) + **superfície de export desabilitada** |
| [src/components/data-grid/filter-bar.tsx](../../src/components/data-grid/filter-bar.tsx) | **novo** | chips de filtro simples (Select por campo) + "Limpiar" + **"Más filtros" desabilitado** (PR-004/FWW) |
| [src/components/data-grid/saved-views-bar.tsx](../../src/components/data-grid/saved-views-bar.tsx) | **novo** | tabs de visões — **foundation local/in-memory** (predicate client-side; sem persistência) |
| [src/components/data-grid/column-visibility.tsx](../../src/components/data-grid/column-visibility.tsx) | **novo** | dropdown de checkboxes p/ colunas `hideable` |
| [src/components/data-grid/selection-summary-footer.tsx](../../src/components/data-grid/selection-summary-footer.tsx) | **novo** | rodapé **sticky** com contagem + slot de resumo + menu "Acción en masa" |
| [src/components/data-grid/entity-link.tsx](../../src/components/data-grid/entity-link.tsx) | **novo** | identificador + chevron de drill-down; integra abas via `useInternalTabsOptional` (degrada sem provider); route-safe |
| [src/components/layout/internal-tabs.tsx](../../src/components/layout/internal-tabs.tsx) | editado (+12, **aditivo**) | `useInternalTabsOptional()` (retorna `null` sem provider) — não altera contratos do PR-002 |
| [src/app/(dashboard)/maestros/productos/productos-table.tsx](../../src/app/(dashboard)/maestros/productos/productos-table.tsx) | editado (piloto) | migra `DataTable`→`EnterpriseDataGrid`; **CRUD/diálogos/actions preservados** |
| [docs/.../IMPLEMENTATION_NOTES_PR003.md](IMPLEMENTATION_NOTES_PR003.md) / [HANDOFF_CURRENT.md](HANDOFF_CURRENT.md) | docs | este arquivo + atualização do handoff |

**Sem novos pacotes** (TanStack `@tanstack/react-table@8.21.3` já cobre sort/filter/visibility/selection/**pinning**/expand/pagination; reusa Input/Button/Checkbox/DropdownMenu/Select, StatusBadge/MoneyAmount e tokens PR-001).

## API do `EnterpriseDataGrid`
```tsx
type EnterpriseDataGridProps<T> = {
  data: readonly T[];
  columns: ColumnDef<T, unknown>[];      // colunas podem trazer meta { align, width, pinned:"left", label }
  getRowId: (row: T) => string;
  // Toolbar
  title?, primaryAction?: React.ReactNode;
  quickSearch?: { placeholder?: string; keys: (keyof T)[] };   // busca textual OR sobre os campos
  filters?: { columnId: string; label: string; options: {value,label}[] }[];  // chips (AND)
  savedViews?: { id, label, predicate?(row): boolean }[];      // in-memory (sem persistência)
  // Seleção / massa
  enableRowSelection?: boolean;
  selectionSummary?: (rows: T[]) => React.ReactNode;           // slot do rodapé
  bulkActions?: (rows: T[]) => React.ReactNode;                // itens do menu "Acción en masa"
  // Drill-down inline
  renderExpanded?: (row: T) => React.ReactNode;
  // Export (superfície desabilitada/futuro PR-005)
  exportSurface?: boolean;                                     // default true → botão "Exportar" disabled
  // Densidade / estados
  density?: "comfortable" | "dense" (default "dense"); zebra?: boolean (default true);
  isLoading?, error?, emptyMessage?, emptyFilteredMessage?;
  pageSize?: number (default 50; selector 28/50/100);
};
```
**Freeze:** colunas com `meta.pinned:"left"` (mais as estruturais seleção/expander) são fixadas via `position:sticky`+`left` calculado por `column.getStart("left")`; o painel fixo tem fundo sólido + borda divisória à direita. **Requisito:** colunas de usuário fixadas devem ser as **líderes** e ter `meta.width` (mapeado p/ `size`, necessário ao cálculo do offset).

## O que foi implementado (no piloto de produtos)
- **Densidade** `dense`+`zebra` por default (tokens PR-001); **cabeçalho fixo**; ~28–30 linhas/1080p.
- **Busca rápida** (`codigo`/`nombre`) + **chip Marca** (AND) + **visões** (Todos/Activos/Inactivos/Stock bajo, predicate in-memory).
- **Ordenação** clicável por cabeçalho (numérica em Stock/Precio via `accessorFn`; textual nas demais).
- **Visibilidade de colunas** (dropdown); **paginação** (28/50/100 + contador).
- **Seleção de linha** (checkbox + "selecionar tudo") + **rodapé sticky** ("N seleccionados" + "Stock total" demonstrativo + menu "Acción en masa" com item futuro desabilitado).
- **Expansão** (linha-detalhe read-only: descrição/modelo/unidad/NCM/stock mínimo/DIE%).
- **Freeze** das colunas líderes (seleção + Código) com sombra/borda divisória.
- **EntityLink** na coluna Código (modo menu/ação → abre o diálogo de edição existente; itens "nueva pestaña"/"registros relacionados" desabilitados "Pronto"; integração `openTab` ativa quando o top-nav estiver ON).
- **CRUD preservado** (criar/editar via `ProductoFormDialog`; excluir via `eliminarProductoAction` + confirmação) — mesma carga de dados (`listarProductos`).

## O que NÃO foi implementado (intencional — fora do escopo PR-003)
- **Export real** (lógica/permissão/auditoria) → **PR-005**: superfície **desabilitada** ("Exportar" + tooltip). Nenhum dado sensível exposto; produtos **não** exibe coluna de custo/margem.
- **"Más filtros"/AdvancedFilters em FloatingWorkWindow** → **PR-004** (placeholder desabilitado).
- **`PermissionGate`/permissão de coluna** e **auditoria** → **PR-005**.
- **Persistência de visões** (URL/sessionStorage), **visões pessoais**, limites por perfil → futuro (a barra é declaradamente in-memory; **não** finge persistência).
- **Resize/reorder de coluna por UI** e **pin por clique-direito/3ª coluna (status)** → futuro (há só `meta.width`/`columnOrder` + left-pin das líderes).
- **Migração das outras 4 tabelas** (`depositos`/`proveedores`/`clientes`/`periodos`) — seguem no `DataTable` antigo.

## Comandos de validação e resultados

| comando | resultado |
|---|---|
| `pnpm typecheck` | ✅ **exit 0** (após limpar `.next`). |
| `pnpm build` | ✅ **exit 0** — "Compiled successfully". (A flag `TOP_NAV_ENABLED` é runtime → o build compila todo o código, incluindo o caminho top-nav do `EntityLink`/`internal-tabs`.) |
| `pnpm exec eslint` (10 arquivos) | ✅ **0 erros, 1 warning** — `react-hooks/incompatible-library` no `useReactTable` (inerente a TanStack Table + React Compiler; **já existia** no `productos-table` anterior, que chamava `useReactTable` direto). |
| `biome check` (10 arquivos) | ✅ **limpo** (após auto-format). |
| `pnpm biome:ci` (repo) | ✅ passa — **40 warnings pré-existentes** (mesmo baseline do PR-001/PR-002), **nenhum** nos arquivos do PR-003. |
| `pnpm test` (`vitest run`) | ✅ **489 passados + 12 skipped (501)** com Docker — **zero falha de asserção**; nenhum teste referencia código do PR-003. **Pré-requisito de ambiente:** `pnpm prisma generate` antes da suíte — o client gerado (`src/generated/prisma`, **git-ignorado**) estava stale vs. `schema.prisma` (gerado 2026-06-21 × schema 2026-06-22), produzindo erro fantasma `column regularizadora does not exist` em ~215 testes; é drift de ambiente local, **não relacionado ao PR-003** (que não toca Prisma/schema/migrations). Após `prisma generate`, verde. 1 suite (`desconsolidacion`) teve **timeout transitório do Testcontainers** (port-binding 10s sob 79 arquivos em paralelo) → **passa 12/12 no retry isolado**. |
| e2e grid por browser | ⏸️ **diferido** — suíte Playwright do repo é service-level (sem browser). Cobertura aqui = typecheck/build/lint + vitest + QA manual. |

## QA visual (checklist manual — requer dev server + sessão)
Não executado nesta sessão (`(dashboard)` exige sessão autenticada). Em `/maestros/productos`:
- ~28–30 linhas/1080p (linha 32px/cabeçalho 34px/13px); zebra some em hover/seleção; **cabeçalho fixo** ao rolar.
- **Colunas fixas** (seleção+Código) permanecem ao rolar horizontalmente, com borda divisória.
- **Busca** filtra código/nome; **chip Marca** filtra (AND); **visões** (Todos/Activos/Inactivos/Stock bajo) refiltram sem reload.
- **Ordenação** por cabeçalho (Stock/Precio numéricos); **visibilidade de colunas** oculta/mostra; **paginação** 28/50/100 + contador.
- **Seleção** marca linhas; **rodapé sticky** mostra "N seleccionados" + "Stock total" + menu massa (item "Exportar selección" desabilitado).
- **Expand** abre detalhe read-only; **EntityLink** (Código) abre o diálogo de edição + chevron com itens futuros desabilitados.
- **Exportar** e **Más filtros** desabilitados com tooltip; **CRUD** (criar/editar/excluir) funciona como antes; botões com **texto** (G-03).
- Com `TOP_NAV_ENABLED=ON`: o `EntityLink` com `href` (páginas futuras) abriria aba via `openTab` — no piloto sem rota de ficha valida-se o modo menu/ação.

## Riscos / pontos p/ PR-004+
- **Freeze:** mecanismo via `meta.pinned` validado nas colunas líderes; pin de status/3ª coluna e pin por clique-direito ficam para um PR posterior. Colunas fixadas precisam ser as líderes e ter `width`.
- **EntityLink:** quando uma página tiver rota de ficha (`/[id]`), passar `href`+`tabLabel` ativa o open-record-in-tab; o piloto não tem rota dedicada (edita por diálogo).
- **PR-004 (FloatingWorkWindow):** hospedará "Más filtros"/AdvancedFilters e o quick-create; ligar `dirty`/`locked` reais às abas.
- **PR-005 (Permissão+Auditoria):** habilitar export auditado + permissão de coluna/export; ocultar colunas sensíveis **totalmente**.
- **Migração incremental:** cada worklist migra `DataTable`→`EnterpriseDataGrid` quando seu módulo for endereçado (define `columns` com `meta`, `quickSearch`, `filters`, `savedViews`); o `DataTable` antigo é o fallback/rollback.

## Rollback
- **Piloto:** reverter `productos-table.tsx` para o `DataTable` anterior (1 arquivo).
- **Total:** remover `src/components/data-grid/` + reverter o hook aditivo em `internal-tabs.tsx`. **Zero efeito** em dados/migração/motores/permissão.
