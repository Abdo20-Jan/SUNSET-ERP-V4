# PR-015 — Shell Cutover (AppShell default + retire legacy shell)

**Branch:** `pr-015-shell-cutover` · **Base:** `origin/main` (`e8ee2e39`, inclui PR-014 #340)
**Onda:** 1 (hygiene). Promove o `AppShell` (PR-002, atrás da flag) a **chrome default**, mantém um
**kill-switch reversível**, reconcilia para **uma fonte de nav + um command palette**, e fecha os gaps de
paridade — **sem alterar rotas, server actions, dados, comportamento de página, schema, auth, permissões
ou engines de negócio.**

É a ÚNICA PR que muda intencionalmente a UX global default → regra = paridade total + kill-switch + QA
pesado, não "inerte por default".

---

## Kill-switch / rollback

- `isTopNavEnabled()` (`src/lib/features.ts`) passou de `=== "true"` → **`!== "false"`**: default **ON**
  (AppShell). Único consumidor de código: `(dashboard)/layout.tsx` (default → AppShell; fallback → legado).
- **Rollback:** setar a env var **`TOP_NAV_ENABLED=false`** (literal) restaura o shell legado
  (`ShellProvider` + `AppTopnav`) intacto. Sem migração/dados — puramente de apresentação.
- `features.ts` é `server-only`, lido só no server component async → sem exposição ao bundle client/SSR.
- O cluster legado é **mantido um release** atrás do kill-switch; remoção física → **PR-015b** (ver abaixo).

---

## Parity map (legacy → AppShell)

| Legacy (AppTopnav / nav-config) | AppShell (nav-model) | Status |
|---|---|---|
| `CenterMegaMenu` | `ModuleMegaMenu` | ✅ coberto (agora permission-filtered) |
| ⌘K `CommandMenu` | `GlobalSearch` | ✅ coberto (ambos nav-only; agora permission-filtered) |
| Breadcrumb (`getBreadcrumb`) | `ShellBreadcrumb` (`buildShellCrumbs`) | ✅ coberto |
| User menu + tema + logout | `ShellUserMenu` (+ tema/logout) | ✅ coberto |
| `FavoritesBar` + `FavoriteToggle` | **portados** p/ AppShell (mesmos componentes) | ✅ coberto |
| `NavDrawer` (hambúrguer mobile) | **novo** `ShellNavDrawer` (nav-model) | ✅ coberto |
| `/sistema/usuarios` (PERM-01, ADMIN_ACCESO) | era `future` sem href → **ativado** + gate | ✅ **gap fechado** |
| `/sistema/aprobaciones` (APROBACIONES_VER) | **ausente** → **adicionado** + gate | ✅ **gap fechado** |
| `/contabilidad/reportes/balance` (Bal. sumas y saldos) | **ausente** → **adicionado** | ✅ **gap fechado** |
| `/sistema/auditoria` (AUDITORIA_VER) | presente, sem gate → **gate adicionado** | ✅ paridade RBAC |
| `/admin/recalcular-percepcion-iibb` (admin) | presente, sem gate → **gate ADMIN_ACCESO** | ✅ paridade RBAC |
| Legacy `Admin → /admin`, `Transferencias → /tesoreria/transferencias` | — | sem gap (essas páginas **não existem**; legado tinha links mortos; nav-model está correto) |
| `/tesoreria`, `/maestros`, `/contabilidad` (overviews) | alcançáveis via filhos/URL/breadcrumb | minor — sem perda de acesso |

Itens **a mais** no nav-model (sem perda): `/tesoreria/pagos-historial`, `/crm/oportunidades/pipeline`,
Comex `Cockpit` (`/comex`).

---

## Mudanças por arquivo

**Kill-switch**
- `src/lib/features.ts` — `isTopNavEnabled()` default ON + JSDoc reescrito (kill-switch).
- `src/app/(dashboard)/layout.tsx` — comentários atualizados (default = AppShell; `=false` = legado). Lógica
  de branch inalterada; ambos os ramos seguem em `<PermissionsProvider>`.

**Fonte única de nav + filtro de permissão**
- `src/components/layout/nav-model.ts` — `ShellNavItem` ganhou `permission?: PermisoKey`; Sistema:
  Permisos→`/sistema/usuarios`+ADMIN_ACCESO, +Aprobaciones+APROBACIONES_VER, Auditoría+=AUDITORIA_VER,
  Herramientas admin+=ADMIN_ACCESO; Contabilidad: +Balance de sumas y saldos. `flattenNavTargets(modules?)`
  passou a aceitar a lista filtrada (default = `SHELL_MODULES`).
- `src/components/layout/nav-permissions.ts` — `filterModulesByPermission` (+ helpers `isModuleItemAllowed`,
  `filterModule`), espelhando o filtro de CENTERS. Reusa `hasClientPermission`. Invariante:
  `permisos === undefined ⇒ retorna a mesma árvore` (zero regressão, referência estável).
- `src/components/auth/permissions-provider.tsx` — `useVisibleModules()` (par de `useVisibleCenters()`).
- `src/components/layout/module-mega-menu.tsx` — consome `useVisibleModules()`.
- `src/components/layout/global-search.tsx` — `flattenNavTargets(useVisibleModules())`.

**Abas internas (aditivo)**
- `src/components/layout/internal-tabs.tsx` — persistência em `sessionStorage` via `useSyncExternalStore`
  (padrão SSR-safe do `shell-provider`; sem `set-state-in-effect`); flags transitórias (`dirty`/`locked`/
  `alert`) são **removidas ao persistir** → sem indicador fantasma após reload. `closeTab` em aba `dirty`
  pede **confirmação** (Dialog "¿Descartar cambios?"). Indicador `!` (`alert?`) adicionado (inerte, como
  `dirty`/`locked`). `TabStripItem` extraído (complexidade ≤8).

**Favoritos (portados, componentes reusados sem mudança)**
- `src/components/layout/app-shell.tsx` — envolve o corpo em `<ShellProvider>`; `<FavoriteToggle>` na linha
  do breadcrumb; `<FavoritesBar>` independente do breadcrumb; monta `<ShellNavDrawer>` no header.

**Mobile**
- `src/components/layout/shell-nav-drawer.tsx` — **novo**; hambúrguer `md:hidden` dirigido por
  `useVisibleModules()`.

**Testes**
- `test/nav-permissions.test.ts` — `describe(filterModulesByPermission)`: undefined-passthrough,
  ocultar/mostrar gateados, módulos-folha sempre passam, módulo-pai totalmente gateado é removido.

---

## Comportamento dirty-close (NÃO é latente)

`DirtyFooter` (`src/components/record/dirty-footer.tsx`) já chama `openTab({..., dirty})` e é usado com
`tabHref` em **3 telas de edição**: `maestros/depositos/[id]`, `maestros/clientes/[id]`,
`sistema/usuarios/[id]`. Com o AppShell default, abrir uma dessas e fechar a aba com `*` dispara o Dialog.
→ **QA obrigatório nessas 3 telas.** `locked`/`alert` seguem sem origem (PR-004); campos existem e renderizam.

---

## Checklist de QA manual (env local seguro: Postgres descartável + `AUTH_URL=localhost`, nunca prod)

- [ ] Todo center/módulo/rota alcançável via top-nav + ⌘K (percorrer todo o nav-model).
- [ ] 3 entradas restauradas alcançáveis: `/sistema/usuarios`, `/sistema/aprobaciones`, `/contabilidad/reportes/balance`.
- [ ] ⌘K abre o GlobalSearch; navega; agrupado por módulo.
- [ ] Abas: abrir várias, reload → persistidas; fechar → removidas; fechar aba ativa → navega à vizinha.
- [ ] **Dirty-close**: abrir `maestros/clientes/[id]`, editar (mostra `*`), fechar aba → Dialog; reload → sem `*` fantasma.
- [ ] Breadcrumb correto em lista + detalhe (`… · Detalle`).
- [ ] Favoritos: estrela → chip na barra → navega → remove; sobrevive ao reload; visível em ambos os shells (key compartilhada).
- [ ] Dark mode (ShellUserMenu); sem entrada de nav morta/órfã.
- [ ] RBAC OFF (default) mostra TODO o nav (zero regressão). RBAC ON não-admin oculta itens gateados de Sistema.
- [ ] Kill-switch: `TOP_NAV_ENABLED=false` restaura o shell legado intacto.
- [ ] Mobile: `ShellNavDrawer` abre e cobre todos os módulos.

---

## QA manual (ambiente local seguro) — resultados + correções

Rodado em Postgres descartável (`postgres:18-alpine`, `127.0.0.1:5433`) + `AUTH_URL=localhost`
(nunca prod), login admin/admin123 e qauser/admin123 (role USER, sem perfil → só `USER_BASE_CLAVES`).

**Resultado:** todos os 11 itens **PASS**. Dois crashes latentes do AppShell (PR-002) foram **expostos
pelo cutover** (antes a flag estava OFF e o AppShell nunca era exercido por default) e **corrigidos**:

1. **`internal-tabs.tsx` — loop "Maximum update depth" ao entrar em edição** (DirtyFooter↔InternalTabs).
   O `DirtyFooter` sincroniza `dirty` por effect cujo dep é o objeto de contexto inteiro; como o valor do
   contexto carregava a lista de abas (muda de identidade a cada `openTab`), o effect re-disparava em loop
   (cleanup seta `dirty:false`, body `dirty:true`, oscilando). **Fix:** o contexto passou a carregar **só as
   ações estáveis** (`openTab`/`closeTab`); a lista de abas virou hook reativo do store
   (`useSyncExternalStore`), e o provider **não assina** o store. Assim o `DirtyFooter` depende só de ações
   estáveis e não re-dispara. + `applyOpen` idempotente (no-op quando nada muda). `DirtyFooter` **não** foi
   tocado. Validado nas 3 telas (depositos/clientes/usuarios): dirty `*` → confirm → Cancelar mantém →
   Descartar descarta (não salva) + navega; sem dirty fantasma após reload.

2. **`shell-user-menu.tsx` — crash "MenuGroupContext is missing" ao abrir o menu de usuário.**
   `DropdownMenuLabel` (= base-ui `Menu.GroupLabel`) exige um `Menu.Group` ancestral; o ShellUserMenu usava
   o label sem `DropdownMenuGroup` (o `topnav-user-menu` legado já envolvia, com comentário explícito).
   **Fix:** envolver o label em `<DropdownMenuGroup>` (padrão do legado). Menu abre limpo (perfil/tema/logout).

**Pré-existente, FORA do escopo (não corrigido — flag):** `src/components/ui/saved-views.tsx` e
`src/components/data-grid/column-visibility.tsx` têm o **mesmo** `DropdownMenuLabel` sem `DropdownMenuGroup`
→ mesmo crash latente ao abrir esses dropdowns. São componentes de data-grid (Onda 2/NS-3),
**shell-agnósticos** (idênticos em ambos os shells) — não introduzidos por este PR. Recomendado corrigir num
PR separado (mesma correção de uma linha: envolver em `DropdownMenuGroup`).

**Checklist (todos PASS):** AppShell default (sem legado) · kill-switch `TOP_NAV_ENABLED=false` restaura o
legado + nav legada funciona + volta ao AppShell · top-nav nos módulos + 3 rotas restauradas
(usuarios/aprobaciones/balance) navegam · ⌘K filtra e navega · drawer mobile (md:hidden) cobre todos os
módulos + permissões · favoritos toggle/bar/persistência/navegação · abas abrir/trocar/fechar/persistir no
reload sem flags fantasma · dirty-close nas 3 telas · RBAC OFF mostra tudo / RBAC ON (qauser) oculta Sistema
gateado no top-nav (só Automatizaciones+Mi perfil) e no ⌘K (51→47 itens) · console sem erros de shell em
operação limpa (só ruído `[auth] JWTSessionError` do AUTH_SECRET de QA) · regressão (productos grid,
auditoria, aprobaciones, usuarios) OK.

## Follow-up PR-015b — remoção física do legado (após 1 release de soak)

Deletar **somente após paridade confirmada em produção**. Ordem de dependência:
1. `src/app/(dashboard)/layout.tsx` — remover o ramo legado + import de `AppTopnav`/`ShellProvider` legado;
   simplificar `isTopNavEnabled()` (ou remover a flag).
2. Componentes: `app-topnav.tsx`, `command-menu.tsx`, `center-mega-menu.tsx`, `topnav-user-menu.tsx`,
   `nav-drawer.tsx`, `ui/menubar.tsx` (se sem outros consumidores).
3. Dados/lógica legados: `nav-config.ts`, `lib/nav/center-activo.ts`; remover `useVisibleCenters`/`CENTERS`
   de `permissions-provider.tsx` e as funções de CENTERS em `nav-permissions.ts`.
4. `shell-provider.tsx` + `favorites-bar.tsx` **NÃO** deletar (passaram a ser usados pelo AppShell).

---

## Não-objetivos (estritos)

Sem mudanças de schema/migrations/auth/JWT/session/modelo-de-permissões/engine. Sem mudar rota/action/
validação/dados/comportamento de página. Sem migração de padrões de página (Onda 2), sem rebuild do
dashboard (PR-042), sem refactors/lint não relacionados. Sem `git pull`/`git add .`/commit/push.
