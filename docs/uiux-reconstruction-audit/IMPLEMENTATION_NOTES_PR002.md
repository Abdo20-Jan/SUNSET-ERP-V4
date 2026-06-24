# IMPLEMENTATION NOTES — PR-002 Global Shell / Top Nav / Internal Tabs

Data: 2026-06-23 · Branch: `chore/backup-prod` · **Não commitado.**

> Entrega a **fundação do shell global** (G-02): top-nav textual hierárquico + abas internas + breadcrumb + GlobalSearch de navegação, **atrás de feature-flag** (`TOP_NAV_ENABLED`, default OFF), **sem remover o sidebar** e **sem mover rotas**. Decisão do dono p/ Q3 = rollout paralelo com flag. Consome a fundação do PR-001 (tokens/densidade/`scrollbar-thin`).

## Feature flag
- **Nome:** `TOP_NAV_ENABLED` (env). **Função:** `isTopNavEnabled()` em [src/lib/features.ts](../../src/lib/features.ts) (`server-only`, mesmo padrão das 5 flags existentes).
- **Default:** **OFF** → [layout.tsx](../../src/app/(dashboard)/layout.tsx) monta o shell atual (`SidebarProvider`+`AppSidebar`+`AppHeader`) **idêntico**. Zero regressão.
- **ON** (`TOP_NAV_ENABLED=true`) → o layout monta `<AppShell>` (top-nav, sem sidebar). Lida **no server** (layout é server component) → sem flash/hydration mismatch.
- **Sem pré-requisitos** de dados/migração: é puramente de apresentação. **Rollback = desligar a flag.**

## Arquivos alterados

| arquivo | tipo | conteúdo |
|---|---|---|
| [src/lib/features.ts](../../src/lib/features.ts) | editado (+27) | `isTopNavEnabled()` (lê `TOP_NAV_ENABLED`) |
| [src/app/(dashboard)/layout.tsx](../../src/app/(dashboard)/layout.tsx) | editado (+11/-3) | ramo por flag: ON → `<AppShell>`; OFF → árvore sidebar atual (inalterada). `cookies()` movido p/ dentro do ramo sidebar (não lido no modo top-nav) |
| [src/components/layout/nav-model.ts](../../src/components/layout/nav-model.ts) | **novo** | modelo hierárquico canônico (dados puros) + `isHrefActive`/`isModuleActive`/`flattenNavTargets`/`buildShellCrumbs`/`deriveTabLabel` |
| [src/components/layout/app-shell.tsx](../../src/components/layout/app-shell.tsx) | **novo** | wrapper do top-nav (logo + `ModuleMegaMenu` + `GlobalSearch` + `ShellUserMenu` + `TabStrip` + breadcrumb + banner retroactivo + `<main>`); hospeda `InternalTabsProvider` |
| [src/components/layout/module-mega-menu.tsx](../../src/components/layout/module-mega-menu.tsx) | **novo** | top-nav textual hierárquico (módulo-folha = `Link`; módulo-pai = submenu `DropdownMenu`; `future`=desabilitado "Pronto") |
| [src/components/layout/internal-tabs.tsx](../../src/components/layout/internal-tabs.tsx) | **novo** | `InternalTabsProvider` + `useInternalTabs()` + `TabStrip` (estado em memória, cap 8, indicadores `*`/cadeado) |
| [src/components/layout/global-search.tsx](../../src/components/layout/global-search.tsx) | **novo** | command palette (cmdk) sobre o nav-model — **só navegação**, atalho ⌘K |
| [src/components/layout/shell-user-menu.tsx](../../src/components/layout/shell-user-menu.tsx) | **novo** | menu de usuário do header (avatar + Perfil + logout), **sem** depender do contexto de sidebar |
| [docs/uiux-reconstruction-audit/IMPLEMENTATION_NOTES_PR002.md](IMPLEMENTATION_NOTES_PR002.md) | **novo** | este arquivo |
| [docs/uiux-reconstruction-audit/HANDOFF_CURRENT.md](HANDOFF_CURRENT.md) | editado | seção de status pós-PR-002 |

**Sem novos pacotes** (reusa cmdk, base-ui `DropdownMenu`/`Avatar`, Hugeicons, `Breadcrumb` presentacional, tokens PR-001).

## O que foi implementado
- **Top-nav textual hierárquico (G-02/G-03):** linha de módulos densa (13px); módulos-pais abrem submenus textuais; **nada icon-only** (chevron é só reforço). Item ativo destacado via `usePathname`. Overflow horizontal com `scrollbar-thin`.
- **Modelo de menu canônico** (`nav-model.ts`) fiel à baseline, **só re-rotulando/agrupando rotas existentes**: 14 módulos (Dashboard, Comercial, Clientes, Maestros, Comex, Inventario, Logística, Finanzas, Tesorería, Contabilidad, Compras, CRM, BI, Sistema). Páginas ausentes (COM-05, CLI-02, FIN-03, FIN-04, PERM-01, AUD-01, AUTO-01) = `status:"future"` → desabilitadas com tag **"Pronto"** (nunca navegam). **Nenhuma rota criada/movida/renomeada.**
- **Abas internas (fundação):** strip em memória no nível do shell (sobrevive à navegação client-side); auto-registra a rota atual como aba ativa; trocar/fechar via roteamento Next; `openTab()` exposto p/ o futuro `EntityLink` (PR-003+); modelo já carrega `dirty`/`locked` p/ os indicadores `*`/cadeado.
- **GlobalSearch (fundação de navegação, SEARCH-01):** ⌘K abre palette p/ saltar a páginas. **Sem** busca de entidade/documento (exige backend+permissão).
- **Breadcrumb:** reusa o `Breadcrumb` presentacional alimentado por `buildShellCrumbs` — **sem tocar** o `app-header.tsx` legado.
- **ShellUserMenu:** avatar + Perfil + Cerrar sesión, desacoplado do contexto de sidebar.

## O que NÃO foi implementado (intencional — fora do escopo PR-002)
- **Remoção do sidebar / big-bang:** sidebar legado intacto; convivência por flag.
- **`EnterpriseDataGrid`** (PR-003); **`FloatingWorkWindow`/migração de drawers** (PR-004); `PermissionGate`/`AuditLog`/schema/auth (PR-005).
- **Busca de negócio** no GlobalSearch (só navegação).
- **Abas internas avançadas:** persistência (sessionStorage), confirmação de descarte em aba `dirty` (depende de forms/DirtyFooter — PR-004), trava real (`locked`), favoritos.
- **Realocação Finanças×Tesouraria** (Q5): ambos aparecem como módulos, mas **todos os hrefs apontam às rotas atuais** (`/tesoreria/*`, `/reportes/*`) — nenhuma rota movida.
- **As 7 páginas ausentes** (não criadas).
- `nav-items.ts`/`app-sidebar.tsx`/`app-header.tsx`/`user-menu.tsx`/`ui/sidebar.tsx` — não tocados (fonte do sidebar).

## Comandos de validação e resultados

| comando | resultado |
|---|---|
| `pnpm typecheck` | ✅ **exit 0** (após limpar cache `.next`). |
| `pnpm build` (flag **OFF**) | ✅ **exit 0** — "Compiled successfully"; todas as rotas dinâmicas (`ƒ`). |
| `TOP_NAV_ENABLED=true pnpm build` (flag **ON**) | ✅ **exit 0** — "Compiled successfully". Ambos os ramos compilam. |
| `biome check` (8 arquivos do PR-002) | ✅ **limpo** (após auto-format de quebras de linha). |
| `pnpm biome:ci` (repo) | ✅ passa — **40 warnings pré-existentes** (mesmo baseline do PR-001), **nenhum** nos arquivos do PR-002. |
| `pnpm exec eslint` (8 arquivos do PR-002) | ✅ **exit 0** — 1 `react-hooks/set-state-in-effect` resolvido com `eslint-disable` justificado (sync da lista de abas com o router/URL — **mesmo padrão usado em ~15 lugares do repo**). |
| `pnpm test` | ⚠️ **não executável aqui** — Vitest usa Testcontainers e **Docker está indisponível** (`docker info` falha). PR-002 **não toca lógica testada** (CSS/nav/componentes de apresentação). **Reexecutar com Docker** antes do merge. |

## QA visual (checklist manual — requer dev server + sessão)
Não executado nesta sessão (o `(dashboard)` exige sessão autenticada; sem instância logada). Validar com `TOP_NAV_ENABLED=true` e depois OFF:
- **Flag OFF:** sidebar idêntico ao atual; header/breadcrumb/banner retroactivo inalterados; nenhuma rota muda.
- **Flag ON:** top-nav textual no topo (sem sidebar); módulos abrem submenus; item ativo destacado; itens `future` desabilitados com "Pronto" (não navegam); breadcrumb correto; GlobalSearch ⌘K salta a páginas; abas abrem/trocam/fecham; densidade/baixo brilho (tokens PR-001); itens/botões com **texto** (G-03); `/perfil` e logout pelo `ShellUserMenu`; navegar por ~10 rotas reais sem 404.

## Riscos deixados para PR-003+
- **PR-003 (`EnterpriseDataGrid`)/EntityLink:** ao introduzir o `EntityLink`, chamar `useInternalTabs().openTab(...)` p/ abrir registros em aba (a API já existe).
- **PR-004 (forms/FloatingWorkWindow):** ligar `dirty`/`locked` reais às abas + confirmação de descarte ao fechar aba `dirty`.
- **Aposentar o sidebar:** quando o top-nav for validado por módulo, unificar `nav-items.ts`→`nav-model.ts` e remover o sidebar (PR posterior). Até lá, **dois modelos de nav coexistem** (documentado).
- **e2e de navegação por browser:** a suíte Playwright do repo é service-level (sem browser) → e2e de top-nav fica diferido (exigiria harness de browser; fora do escopo aditivo).
- **`pnpm lint` (eslint do repo inteiro) segue vermelho no baseline** (pré-existente, não introduzido pelo PR-002).

## Rollback
Desligar `TOP_NAV_ENABLED` (volta ao sidebar). Rollback de código: reverter os 2 edits (`features.ts`, `layout.tsx`) + remover os 6 componentes novos. **Zero efeito** em dados/migração/motores.
