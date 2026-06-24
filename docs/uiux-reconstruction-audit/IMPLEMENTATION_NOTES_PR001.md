# IMPLEMENTATION NOTES — PR-001 Design Foundation

Data: 2026-06-23 · Branch: `chore/backup-prod` · **Não commitado.**

## Arquivos alterados

| arquivo | tipo | conteúdo |
|---|---|---|
| [src/app/globals.css](../../src/app/globals.css) | editado (+67) | tokens de cor semântica (`--success/--warning/--info/--process` + `-foreground`, light+dark), mapeamentos `@theme inline` (`--color-*`), tokens de densidade (`--density-row-h/-header/-cell-px`), utilitários opt-in `.table-dense` e `.table-zebra` |
| [src/components/ui/status-badge.tsx](../../src/components/ui/status-badge.tsx) | **novo** | `StatusBadge` (`tone: neutral\|process\|info\|warning\|success\|critical`), compõe `Badge` |
| [src/components/ui/severity-badge.tsx](../../src/components/ui/severity-badge.tsx) | **novo** | `SeverityBadge` (`severity: critical\|warning\|info\|neutral`), compõe `Badge` |
| [src/components/ui/data-table.tsx](../../src/components/ui/data-table.tsx) | editado (+13/-1) | props **opt-in retrocompatíveis** `density?: "comfortable"\|"dense"` (default `comfortable`) e `zebra?: boolean` (default `false`) |
| [src/app/(dashboard)/maestros/productos/productos-table.tsx](../../src/app/(dashboard)/maestros/productos/productos-table.tsx) | editado (+2) | **piloto**: `<DataTable ... density="dense" zebra />` |
| [docs/uiux-reconstruction-audit/DESIGN_FOUNDATION.md](DESIGN_FOUNDATION.md) | **novo** | guia de consumo da fundação para PRs futuros |
| [docs/uiux-reconstruction-audit/IMPLEMENTATION_NOTES_PR001.md](IMPLEMENTATION_NOTES_PR001.md) | **novo** | este arquivo |
| [docs/uiux-reconstruction-audit/HANDOFF_CURRENT.md](HANDOFF_CURRENT.md) | editado | seção de status pós-PR-001 |

## O que foi implementado
- **Tokens de cor semântica** (status/severidade) em OKLCH, calibrados como texto sobre fundo claro + variantes claras no `.dark`; expostos como utilitários Tailwind (`bg-success`, `text-warning`, …). `critical` reutiliza `--destructive`.
- **Tokens de densidade** (linha 32px / cabeçalho 34px / `px` de célula).
- **Utilitários de densidade de tabela** `.table-dense` e `.table-zebra`, **opt-in** e escopados na `<table>` — não afetam tabelas que não os recebem; zebra exclui `:hover`/selecionada para não competir com os estados do `TableRow`.
- **`StatusBadge` e `SeverityBadge`** compondo o `Badge` existente.
- **`DataTable`** com props opt-in (`density`/`zebra`), 100% retrocompatível.
- **Piloto** `/maestros/productos` (MAE-PROD-01, ~1053 linhas) com `dense` + `zebra` para provar densidade.
- **Documentação de consumo** (`DESIGN_FOUNDATION.md`).

## O que NÃO foi implementado (intencional — fora do escopo PR-001)
- Top-nav / `AppShell` / `ModuleMegaMenu` (PR-002) — sidebar mantido.
- `EnterpriseDataGrid` (PR-003); `FloatingWorkWindow` / migração de drawers (PR-004).
- `PermissionGate` / auditoria / schema / auth / rotas / motores de cálculo.
- `button.tsx` e `money-amount.tsx` (já conformes — não tocados).
- As outras 4 páginas que usam `DataTable` (depositos, proveedores, clientes, periodos) — inalteradas (default `comfortable`).
- `StatusBadge`/`SeverityBadge` **não** foram fiados em páginas de negócio (apenas fundação + doc).

## Comandos de validação e resultados

| comando | resultado |
|---|---|
| `pnpm typecheck` | ✅ **limpo** após limpar cache `.next` obsoleto. Os 2 erros iniciais (`.next/types/validator.ts` → `api/export/[recurso]`, `api/reportes/balance-general/export`) eram **cache de build de outro branch**; essas rotas não existem aqui. Não há erros de tipo nos arquivos do PR-001. |
| `pnpm biome:ci` | ✅ **passa** — 40 warnings **pré-existentes** (ex.: `services/crm/scoring-engine.ts`), **nenhum** nos arquivos do PR-001. `biome check` dos 4 arquivos TS/TSX = limpo. |
| `pnpm exec eslint` (arquivos PR-001) | ✅ **0 erros, 1 warning** — `react-hooks/incompatible-library` em `useReactTable` (productos-table.tsx:149), **pré-existente** (só adicionei props no JSX). |
| `pnpm lint` (repo inteiro) | ❌ 2235 erros / 47246 warnings — **estado pré-existente do repo** (eslint cobre generated/tests; não é gate verde hoje). **Não introduzido pelo PR-001.** |
| `pnpm build` | ✅ **exit 0** — compila; todas as rotas dinâmicas (`ƒ`). |
| `pnpm test` | ⚠️ **não executável neste ambiente** — Vitest usa Testcontainers e **Docker está indisponível** (`Could not find a working container runtime strategy`). PR-001 **não toca lógica testada** (CSS + componentes apresentacionais + props opt-in), então a suíte de regressão (~80 specs) não é afetada. **Reexecutar com Docker** antes do merge para confirmação formal. |

## QA visual (checklist manual — requer dev server)
Servidor não iniciado nesta sessão. Validar em `/maestros/productos` (1080p):
- [ ] ~28-30 linhas visíveis; linha 32px / cabeçalho 34px / fonte 13px.
- [ ] Zebra sutil nas linhas pares; some no hover/seleção.
- [ ] Cabeçalho sticky; valores `Stock`/`Precio` tabulares à direita.
- [ ] Baixo brilho, paleta neutra; sem cards decorativos.
- [ ] Demais páginas (depositos/proveedores/clientes/periodos) **inalteradas**.
- [ ] (Opcional) Showcase de `StatusBadge`/`SeverityBadge` nos 6/4 tons.

## Riscos deixados para PR-002/PR-003
- **PR-002:** substituição do sidebar por top-nav tocará o shell de todas as páginas (G-02) — risco médio; usar feature-flag de navegação.
- **PR-003:** `EnterpriseDataGrid` deve **tornar `dense`/`zebra` o default** e absorver `DataTable`; cuidar das 4 páginas atuais ao migrar.
- **`pnpm lint` (eslint) está vermelho no baseline** — recomendar limpeza/ajuste de config de eslint (ou alinhar ao Biome como gate único) num PR de higiene separado; não é escopo de UI.
- **Validação de testes** depende de Docker no ambiente de execução — garantir no CI/máquina com Docker.

## Rollback
Reverter os 3 arquivos editados + remover os 2 componentes novos. Sem efeito em dados/migração. O piloto reverte removendo `density="dense" zebra`.
