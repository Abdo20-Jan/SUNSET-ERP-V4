# PR-022b — CX-01 · Comex · Cockpit Operacional · filtros + vistas/presets + URL state

> **Escopo entregue:** PR-022**b** = camada de **filtros read-only** sobre o cockpit do PR-022a:
> barra URL-driven (Proveedor / ETA / Status) + **saved-view presets estáticos** propagados a todos os
> blocos e indicadores. **Sem calendário, sem export, sem mutações, sem schema, sem nova permissão, sem
> tocar no motor Comex.** Aditivo: **com filtros vazios o cockpit é idêntico ao PR-022a**.
> **Branch:** `pr-022b-comex-cockpit-filtros-vistas` (limpa de `origin/main` @ `c378ded0`, já com PR-022a #355).

## Diferido (NÃO neste PR)

- **PR-022c:** calendário operacional semanal (+ agrupamento de eventos), filtro **Modal** (sem campo no
  schema — gap), Más filtros (responsable/free-time/alerta — dados inexistentes), vista
  **[Cancelados]/Auditoría** (`EmbarqueEstado` sem `CANCELADO`; gating `AUDITORIA_VER`), "lembrar última
  vista" (localStorage), busca rápida.
- **PR-022d** (ou 022c só se aprovado): **Exportar Día** auditado, export PDF/Excel/CSV.
- **Nenhum** evento/ack/responsable/execução de próxima ação.

## Modelo de filtros (URL params)

Tudo opcional, na rota `/comex`. Parse/normalização puros em `comex-cockpit-filtros.ts`.

| Param | Valores | Default | Inválido → |
|---|---|---|---|
| `vista` | `todos \| criticos \| proximos \| transito \| sin-actualizar \| pagos` | `todos` | `todos` |
| `proveedor` | `proveedorId` | — | aplicado tal qual (sem match → 0 linhas; opção só existe se houver proceso) |
| `eta_desde` | ISO `yyyy-mm-dd` | — | descartado |
| `eta_hasta` | ISO `yyyy-mm-dd` | — | descartado (se `desde>hasta`, descarta `hasta`) |
| `estado` | um `EmbarqueEstado` não-CERRADO | — | descartado |
| `moneda` | `USD \| ARS` (PR-022a) | pref. usuário | inalterado |

- **Composição:** `filtros = merge(presetToFiltros(vista, now), paramsExplícitos)`. Params explícitos
  (`proveedor`/`estado`/`eta_*`) sobrescrevem o campo do preset; dimensões disjuntas em **AND**.
- **UX da barra:** presets (tabs) e filtros explícitos Status/ETA são mutuamente excludentes (escolher um
  limpa o outro); **Proveedor é ortogonal** (preservado). Tudo escrito na URL (`useSearchParams` +
  `router.push` + `useTransition`), espelhando `embarques-views-bar` (PR-020). Reload preserva o estado.

## Saved-view presets (estáticos — NÃO o modelo `SavedView` persistido)

Definições estáticas (combos de filtro em URL). **Não** usam o modelo Prisma `SavedView`/`guardarVista`
(seria mutation + toca padrão de schema).

| Preset | Filtros | Permissão | Sem permissão |
|---|---|---|---|
| **Todos** | `{}` | — | visível |
| **Críticos** | `foco=criticos` (= `clasificarSeveridad === "critico"`) | — | visível |
| **Próximos arribos** | `etaHasta = now+15d` (reusa `resolverVistaFiltro("proximos")`) | — | visível |
| **En tránsito** | `estado=[EN_TRANSITO]` (reusa `resolverVistaFiltro("transito")`) | — | visível |
| **Sin actualizar** | `foco=sin-actualizar` (= `bandDiasSinActualizacion !== "fresca"`, >5d) | — | visível |
| **Pagos próximos** | `foco=pagos` (embarques com pago exterior ≤30d) | **`VER_COSTO_LANDED`** | tab **omitida**; `?vista=pagos` forjada degrada seguro (set vazio, financeiro omitido) |

**Modal** e **[Cancelados]** omitidos: sem campo de modal no schema; `EmbarqueEstado` sem `CANCELADO`.

## Default fixo — diferido (decisão do dono)

Default = `vista=todos` + sem params = **idêntico ao PR-022a**. Sem schema, sem mutation, sem efeito
client. Estado segue compartilhável via URL. "Lembrar última vista" (localStorage) → PR futuro. Sem uso
de `SavedView.esPredeterminada` (exigiria server action).

## Threading nos readers (filtros → 6 blocos + 4 indicadores)

**Princípio:** a query base de `getCockpitData` **não muda** (`estado != CERRADO`, mesmos 2 round-trips).
Todo narrowing é **in-memory** sobre o `enriched[]` já carregado → "filtros vazios = PR-022a" é trivial e
as opções de Proveedor saem do set completo sem query extra.

- `getCockpitData({ now, verCosto, filtros? })` — `filtros` default `{}`.
- `EMBARQUE_COCKPIT_SELECT` ganhou **só** `proveedorId` (escalar **não-monetário** — anti-leak intacto)
  para montar `proveedorOpciones` e filtrar.
- `aplicarFiltrosEnriched(enriched, filtros, { now, pagosEmbarqueIds })` narra em AND: `proveedorId`,
  `estado` (membership), ETA range (ETA nula excluída quando há filtro), `foco` (criticos via
  `clasificarSeveridad`; sin-actualizar via `bandDiasSinActualizacion`; pagos via membership de embarqueIds).
- Todos os 6 mappers + `mapIndicadores` + `filtrarCriticos` operam sobre o set narrado → contadores,
  somas e `[Ver todos]` counts refletem o universo filtrado.
- **Pagos / financeiro:** `mapPagosExteriores` narra por `proveedorId` (única dimensão semanticamente
  aplicável; ETA/estado/foco N/A a pagos). `cashOut30dUsd` deriva dos pagos narrados.
- **[Ver todos]:** Próximos arribos → `/comex/embarques?vista=proximos&moneda=…` via `cockpitFiltrosToQuery`
  (a worklist lê `vista`/`moneda`; demais params são ignorados com segurança). Pagos → `/comex/proveedores`.

## Permissão / masking (real, sem inventar chave)

- Única chave: **`PERMISOS.VER_COSTO_LANDED`** (`costos.verLanded`, dimensão CAMPO). **Nenhuma** chave
  por-seção (`ver_valores_financieros`/`ver_costo_comex`/`comex.cockpit.*`) existe → **nada inventado**.
- Gate inalterado do PR-022a: a page resolve `verCosto = hasPermission(VER_COSTO_LANDED)` e o passa a
  `getCockpitData`. `maskField` zera FOB/cash-out e a seção `financeiro` é **omitida do payload**.
- Tab **Pagos próximos** renderizada só com `verCosto`. `?vista=pagos` forjada sem permissão: o serviço
  ignora o `foco` e `pagosEmbarqueIds` fica vazio → cockpit normal, financeiro omitido. **Sem leak.**

### Prova de máscara server-side (CRIT-10)
- O único campo novo no `select` é `proveedorId` (escalar, não-financeiro). O `select` segue estreito:
  nunca traz colunas monetárias de `EmbarqueCosto` nem `costoTotal`.
- Filtros só **reduzem** linhas; **nunca** ampliam o payload. Um filtro não pode revelar valor que a
  página sem filtro não enviaria — o gate `verCosto` e a omissão server-side valem sob qualquer filtro.

### OD-08 — limitação preservada
Não há gating por-seção real além de `VER_COSTO_LANDED` (catálogo não tem chave por-seção). Operación/
Documentos/Custos seguem visíveis a quem acessa `/comex`. **Não se alega OD-08 completo.**

## Motor intocado / nada recomputado (G-09 / CRIT-04..10)

- `comex-cockpit-filtros.ts` e `comex-cockpit.ts` **não importam** `services/comex.ts` (rateio/CIF/
  tributos). Nenhum valor é recalculado: filtros só selecionam linhas já derivadas de campos armazenados.
- Reuso verbatim de helpers puros existentes (`resolverVistaFiltro`, `clasificarSeveridad`,
  `bandDiasSinActualizacion`). Nenhuma action, transação ou write. Nenhuma mudança de schema/migration.

## Arquivos

### Novos
- `src/lib/services/comex-cockpit-filtros.ts` — módulo PURO (sem `server-only`): `CockpitFiltros`,
  `ProveedorOpcion`, `COCKPIT_VISTAS`, `STATUS_FILTRO_OPCIONES`, `parseCockpitVista`, `presetToFiltros`,
  `parseCockpitFiltros`, `cockpitFiltrosToQuery`, `aplicarFiltrosEnriched`.
- `src/app/(dashboard)/comex/_components/cockpit-filtros.tsx` — barra client URL-driven.
- `test/comex-cockpit-filtros.test.ts` — parse/presets/query/narrowing (incl. no-op e gating de `pagos`).
- este documento.

### Modificados (aditivo/read-only)
- `src/lib/services/comex-cockpit.ts` — param `filtros`; `proveedorId` no select; `proveedorOpciones`;
  `aplicarFiltrosEnriched`; narrow de pagos por proveedor; novo campo `proveedorOpciones` em `CockpitData`.
- `src/app/(dashboard)/comex/page.tsx` — searchParams ampliado; `parseCockpitFiltros`; passa `filtros`
  e `verCosto`.
- `src/app/(dashboard)/comex/_components/cockpit.tsx` — render `<CockpitFiltros>`; prop `verCosto`;
  `[Ver todos]` de arribos via `cockpitFiltrosToQuery`.

### NÃO tocados (proibidos)
`prisma/schema.prisma`, migrations, auth/permissões (sem chaves novas), `services/comex.ts`,
`despacho-parcial.ts`, `contenedor.ts`, `embarque-zpa.ts`, `actions/{embarques,despachos,contenedores,
vep-embarque,vep-despacho}.ts`, engines de stock/asiento/cost/margin/rateio, primitivos compartilhados
(`components/data-grid/*`), `embarques-views-bar.tsx` (só espelhado), cliente Prisma gerado, artefatos.

## Validação

| Comando | Resultado |
|---|---|
| `pnpm prisma generate` | _(preencher)_ |
| `pnpm typecheck` | _(preencher)_ |
| `pnpm build` | _(preencher)_ |
| `pnpm biome:ci` | _(preencher)_ |
| `pnpm test` | _(preencher)_ |

`db:validar-stock` / `db:validar-asientos`: **não executados** (PR read-only, zero schema/engine/action;
`.env` aponta para Railway = PRODUÇÃO → STOP). Invariantes de dados armazenados são comprovadamente
inalteráveis (nenhum write/motor tocado); as suítes de invariantes Comex rodam nos testes acima.

## QA manual (env local seguro — NUNCA prod; admin/admin123)

1. `/comex` carrega; AppShell/nav intactos. 2. Barra de filtros acima dos blocos. 3. Mudar filtro
atualiza a URL. 4. Reload preserva estado. 5. Param inválido normaliza (sem crash). 6. Proveedor/ETA/Status
narram **todos** os blocos. 7. Modal **ausente** (gap). 8. Presets mudam URL/estado. 9. **Filtros vazios =
contadores/semântica do PR-022a**. 10. `[Ver todos]` de arribos preserva `moneda`; linha abre
`/comex/embarques/[id]`. 11. **Sem** mutação inline / export / calendário. 12. `/comex/embarques`,
`/comex/embarques/[id]`, simulaciones/proveedores OK.
- **Permissão:** sem `VER_COSTO_LANDED` → indicadores financeiros "—", arribos sem FOB, bloco Financeiro =
  placeholder, tab **Pagos próximos ausente**; `?vista=pagos` forjada degrada seguro; nenhum valor no payload.

## Rollback

Remover os 3 arquivos novos + o teste; reverter os 3 modificados aos seus estados do PR-022a (filtros são
puramente aditivos). Nenhuma migração/seed/dado a reverter.
