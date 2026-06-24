# 11 — Plano detalhado: PR-001 Design Foundation (NÃO implementar)

> Plano de Plan Mode para o **primeiro** PR de implementação. Este documento **não** implementa nada. Backend, lógica e navegação ficam intocados.

## Objetivo
Formalizar a **fundação de design corporativa** (tokens de densidade, cor, tipografia) exigida por `04_DESIGN_SYSTEM.md` e G-01, e provar a densidade alvo (linha 32px, fonte 13px, cabeçalho 34px, **28-30 linhas em 1080p**, números tabulares) em **uma página piloto**, sem alterar dados nem navegação.

## Estado atual (ponto de partida — já alinhado em parte)
[src/app/globals.css](../../src/app/globals.css) já entrega: paleta **warm-light OKLCH** (papel quente), **primary azul-grafite SAP-style** low-saturation, cor forte só em `--destructive`, `body` em **13px**, `tabular-nums` em `.font-mono`, `--radius: 0.4rem`, charts financeiros. ➡️ **A cor/tipografia base está conforme.** O que falta é **densidade tokenizada** e sua aplicação consistente.

## Gap a fechar
- Sem tokens de **altura de linha de tabela (32px)**, **cabeçalho (34px)**, escala de espaçamento densa.
- Densidade não garantida (28-30 linhas/1080p) em tabelas.
- Números monetários nem sempre usam fonte tabular (depende de `.font-mono`).

## Arquivos provavelmente afetados
- [src/app/globals.css](../../src/app/globals.css) — adicionar tokens de densidade (`--row-h: 32px`, `--row-h-header: 34px`, `--cell-px`, `--density-font: 13px`) no `@theme inline`/`:root`.
- Config Tailwind (via `@theme`) — expor utilitários de densidade.
- Primitivos de tabela: [components/ui/table.tsx](../../src/components/ui/table.tsx) (altura de linha/cabeçalho sticky), [components/ui/money-amount.tsx](../../src/components/ui/money-amount.tsx) (forçar tabular).
- 1 **página piloto** (sugestão: uma worklist densa já existente, ex. `/contabilidad/asientos` ou `/inventario`) para validar — **somente classes/estilo**, sem mexer em dados.

## Componentes/tokens a criar ou refatorar
- Tokens de densidade (novos).
- `MoneyCell` mínimo (ou ajuste de `money-amount`) garantindo `font-variant-numeric: tabular-nums`.
- Documentar a escala em um comentário no `globals.css` (paleta + densidade).

## Non-goals (exatos)
- ❌ Não trocar navegação (sidebar→top-nav é o PR-002).
- ❌ Não criar `EnterpriseDataGrid` (PR-003) nem `FloatingWorkWindow` (PR-004).
- ❌ Não tocar permissão/auditoria (PR-005).
- ❌ Não alterar nenhuma server action, serviço, schema ou cálculo.
- ❌ Não migrar drawers; não remover componentes.
- ❌ Não aplicar a fundação a todas as páginas — **só ao piloto**.

## Risco
- **Baixo.** Mudança puramente cosmética/estilo. Risco residual: regressão visual em páginas que herdam tokens globais → mitigar mantendo defaults atuais e adicionando tokens **novos** (não renomear/remover os existentes).

## Comandos de validação
```
pnpm typecheck
pnpm biome:ci
pnpm lint
pnpm build
pnpm test        # garante que nada de lógica quebrou (deve seguir 100% verde)
```
(Não há e2e de UI ainda; PR-001 não toca Comex/contábil, então `pnpm test:e2e` não é obrigatório aqui.)

## Expectativas de QA visual
- Página piloto em 1080p mostra **28-30 linhas** de tabela sem espaços artificiais.
- Linha 32px / cabeçalho 34px / fonte 13px.
- Números/valores em **fonte tabular** alinhados à direita.
- Baixo brilho, paleta neutra; cor forte apenas em alerta/destrutivo.
- Sem cards decorativos; zebra sutil; bordas finas; cabeçalho sticky.

## Critérios de aceite
- [ ] Tokens de densidade adicionados e documentados no `globals.css` (sem remover tokens existentes).
- [ ] Página piloto atinge 28-30 linhas/1080p em densidade corporativa.
- [ ] Valores monetários tabulares no piloto.
- [ ] `typecheck` + `biome:ci` + `lint` + `build` + `test` verdes.
- [ ] Nenhuma alteração em `lib/`, `prisma/`, actions ou navegação (diff restrito a `globals.css`, config de estilo, primitivos `ui/` e o piloto).
- [ ] Screenshots antes/depois do piloto anexados ao PR.

## Próximo passo após PR-001
Seguir para **PR-002 (Global Shell / Top-Nav / Internal Tabs)** — ver [10_PR_ROADMAP.md](10_PR_ROADMAP.md).
