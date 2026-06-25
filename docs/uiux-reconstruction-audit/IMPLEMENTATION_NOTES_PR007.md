# PR-007 — PermissionGate (Frontend) + Navigation Gating · Notas de implementação

> Metade FE do RBAC (Wave 0). **Consome** a fundação do PR-006 (modelo + motor + snapshot de
> sessão) e entrega a **camada de permissão reutilizável no frontend**: um provider/hook fino,
> o componente `PermissionGate` (mascaramento híbrido) e a navegação ciente de permissão.
> **Aditivo e backward-compatible:** com `RBAC_ENABLED` OFF (default) ou sem dados de permissão,
> renderiza/mostra **tudo** — idêntico a hoje. Não toca o modelo/motor RBAC, nem auth/JWT/shape
> de sessão, nem nenhum motor de cálculo. Regras-fonte: **G-06** (tudo depende de permissão, FE
> **e** BE), **PAGE-STD-02 funcional 7** e **PERM-01 funcional 7** (mascaramento híbrido).

## Por que existe
O PR-006 expôs `session.user.permisos?: string[]` (snapshot opcional) mas **nada no FE o
consome**. Sem uma camada FE, não há como esconder itens de nav, mascarar campos ou desabilitar
ações por permissão. Este PR entrega essa camada reutilizável e desbloqueia PR-009 (página
PERM-01) e PR-011 (máscara custo/margem). É **só FE e aditivo** — nenhuma regra de negócio,
action ou validação existente muda.

## Contrato de consumo (como o FE lê o PR-006)
- `src/app/(dashboard)/layout.tsx` (RSC) já roda `await auth()`. Passa `session.user.permisos`
  (`string[] | undefined`, JSON-serializável) como prop para o provider client. **Só leitura** —
  o FE nunca redefine sessão/JWT; a autorização real continua no BE (que sempre revalida na DB).
- O provider client expõe o snapshot via contexto. O predicado base é puro e node-testável:
  ```ts
  hasClientPermission(permisos, key) = permisos === undefined ? true : permisos.includes(key)
  ```
  O ramo `undefined → true` **é** a garantia de backward-compat inteira (flag OFF / token legacy
  ⇒ libera tudo). A máscara FE é reflexo de UX, nunca a única proteção (PERM-01 §6).

## Arquivos criados
- **`src/components/layout/nav-permissions.ts`** (puro, sem `"use client"`) — `hasClientPermission`
  e `filterCentersByPermission(centers, permisos)` com helpers extraídos (`isItemAllowed`,
  `filterSection`, `filterCenter`) para complexidade ciclomática ≤ 8 (gate Codacy/Lizard). Com
  `permisos === undefined` devolve **a mesma referência** de `CENTERS` (zero regressão); senão
  remove itens/crossLinks sem permissão, seções vazias e centers totalmente vazios.
- **`src/components/auth/permissions-provider.tsx`** (`"use client"`) — `PermissionsProvider`
  (recebe `permisos?`), `usePermissions`, `useHasPermission(key)` e `useVisibleCenters()`
  (CENTERS filtrado, memoizado). Idioma de contexto igual ao `shell-provider.tsx`.
- **`src/components/auth/permission-gate.tsx`** (`"use client"`) — `PermissionGate({permission,
  variant, children, message?, tooltip?})`. Permitido (ou sem RBAC) → renderiza `children`;
  negado → degrada por variant (dispatch enxuto), **layout estável**:

  | variant | negado → |
  |---|---|
  | `field` | `—` + tooltip (TooltipProvider local) |
  | `block` | bloco com mensagem |
  | `page` | mensagem central |
  | `column` | não renderizado (`null`) |
  | `button` | child clonado `disabled` + tooltip (espelha `periodos-table.tsx`) |

  Os 5 variants são entregues como peça reutilizável (consumidos por PR-009/PR-011). O
  `TooltipProvider` é montado localmente porque **não há** provider global de tooltip.
- **`test/nav-permissions.test.ts`** (Vitest, env node — casa com o repo; sem jsdom/RTL) — cobre
  o predicado puro (incl. a invariante `undefined → true`) e o filtro de nav (intacto sob OFF,
  Admin escondido sem `admin.acceso`, remoção de seções/centers vazios).

## Arquivos modificados
- **`src/components/layout/nav-config.ts`** — campo opcional `permission?: PermisoKey` em
  `NavItem`; `permission: PERMISOS.ADMIN_ACCESO` **apenas** no item "Admin"
  (`configuracion` → "Sistema" → `/admin`). `ALL_NAV_ITEMS` e `nav-config.test.ts` intactos.
- **`src/app/(dashboard)/layout.tsx`** — envolve **ambos** os shells (novo `AppShell` e o legado
  `ShellProvider`+`AppTopnav`) com `<PermissionsProvider permisos={session.user.permisos}>`.
- **`src/components/layout/app-topnav.tsx`** / **`nav-drawer.tsx`** — trocam `CENTERS` por
  `useVisibleCenters()`. No topnav o `config` virou defensivo (`find` + render condicional do
  `TopnavUserMenu`, sem `!`).
- **`src/app/(dashboard)/maestros/productos/productos-columns.tsx`** — piloto: a ação "Eliminar"
  do `RowActions` usa `useHasPermission(PERMISOS.ADMIN_ACCESO)`; sem permissão fica
  `DropdownMenuItem disabled` + hint inline "Sin permiso" (idioma já usado em `entity-link.tsx`/
  `productos-table.tsx` — menu-safe, sem tooltip-em-dropdown). A action `eliminarProductoAction`
  **não** é tocada.

## Piloto (mínimo e reversível)
- **Nav:** item "Admin" gateado por `admin.acceso`. Flag OFF → todos veem (sem mudança); ON →
  só ADMIN vê — consistente com o page-guard do PR-006 (que já redireciona USER de `/admin`).
- **Maestros:** "Eliminar" de productos desabilitada + hint quando `admin.acceso` ausente.

## Backward-compat (prova)
- **OFF (prod default):** `resolvePermisosParaToken` retorna `undefined` →
  `session.user.permisos === undefined` → `hasClientPermission` é `true` p/ tudo →
  `useVisibleCenters()` devolve o `CENTERS` completo e `PermissionGate` renderiza `children`.
  Nav, mega-menu, drawer, user-menu e o piloto = byte-idênticos ao `main`.
- **ON / ADMIN:** snapshot inclui `admin.acceso` → Admin visível, ação habilitada.
- **ON / USER:** `["app.acceso"]` → Admin some do nav; "Eliminar" desabilitada.

## Fora de escopo (follow-ups)
- **New shell `SHELL_MODULES`/`nav-model.ts`** (atrás de `TOP_NAV_ENABLED` OFF) **não** é gateado
  neste PR — usa `pageCode`/`status`, não chaves de catálogo; gating dele fica para um PR
  seguinte. O nav legado (CENTERS), ativo por default, é o gateado aqui.
- Rollout de máscara custo/margem (PR-011), UI PERM-01 (PR-009), engine de aprovações (PR-012).
- Novas chaves de permissão por módulo/página: pertencem ao catálogo do PR-006 (PR-008/PR-009);
  este PR usa **apenas** chaves já existentes (`admin.acceso`).

## Como exercitar (QA local)
1. `RBAC_ENABLED` ausente/OFF → nav e botões idênticos a hoje (admin vê tudo).
2. `RBAC_ENABLED=true` + seed dos perfis + login com usuário **USER** → item "Admin" some do
   menu e a ação "Eliminar" em productos fica desabilitada com "Sin permiso". Login **ADMIN** →
   tudo visível/habilitado (fast-path).
