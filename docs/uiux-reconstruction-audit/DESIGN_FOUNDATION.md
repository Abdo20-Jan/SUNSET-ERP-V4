# Design Foundation (PR-001) — guia de consumo

> Fundação visual da reconstrução UI/UX. **Aditiva e opt-in:** nada do que está aqui altera páginas existentes, exceto o piloto `/maestros/productos`. Os PRs seguintes (PR-002+) **devem consumir** estes tokens/primitivos em vez de recriar cores, densidade ou badges. Baseline: `04_DESIGN_SYSTEM.md`, `05_WORKLIST_PATTERN.md`, `06_RECORD_PATTERN.md`, G-01/G-03.

## 1. Tokens de cor semântica
Definidos em [src/app/globals.css](../../src/app/globals.css) (`:root` + `.dark`) e expostos no `@theme inline` como utilitários Tailwind.

| Token | Utilitários | Uso canônico |
|---|---|---|
| `--success` → `bg-success` / `text-success` | tinta + texto | finalizado / OK (verde discreto) |
| `--warning` → `bg-warning` / `text-warning` | tinta + texto | pendência / em aprovação (âmbar) |
| `--info` → `bg-info` / `text-info` | tinta + texto | informativo (azul) |
| `--process` → `bg-process` / `text-process` | tinta + texto | em processo (cinza-azulado) |
| `--destructive` (existente) → `bg-destructive` / `text-destructive` | tinta + texto | bloqueio / crítico (vermelho controlado) |

> As cores têm luminância calibrada para servir **como texto** sobre fundo claro (e variantes claras no `.dark`). Use sempre o **fundo tonal + texto na cor** (`bg-x/12 text-x`), nunca cores fortes preenchendo grandes áreas (G-01 / "sem pintar a tela inteira").

## 2. Tokens de densidade
| Token | Valor | Consumo |
|---|---|---|
| `--density-row-h` | 32px | altura de linha (worklist densa) |
| `--density-row-h-header` | 34px | altura de cabeçalho |
| `--density-cell-px` | 0.625rem | padding-x de célula (= `px-2.5` atual do `Table`) |

## 3. Utilitários de tabela (opt-in)
Aplicados na `<table>` (via `className` do `Table`/`DataTable`). **Só afetam a tabela que os recebe.**
- `.table-dense` — aplica `--density-row-h`/`-header` e zera padding vertical das células → ~28-30 linhas em 1080p.
- `.table-zebra` — tinta sutil nas linhas **pares** do corpo, excluindo `:hover` e selecionada (não compete com os estados do `TableRow`).

### Como ligar num grid
```tsx
<DataTable table={table} density="dense" zebra />
```
`density` default = `"comfortable"` (comportamento atual); `zebra` default = `false`. → PR-003 (`EnterpriseDataGrid`) deve tornar `dense`/`zebra` o **default** do grid operacional.

## 4. Primitivos
| Primitivo | Arquivo | Notas |
|---|---|---|
| `StatusBadge` | [src/components/ui/status-badge.tsx](../../src/components/ui/status-badge.tsx) | prop `tone: neutral \| process \| info \| warning \| success \| critical`. Use para a **coluna Status** das worklists e o badge do header de registro. |
| `SeverityBadge` | [src/components/ui/severity-badge.tsx](../../src/components/ui/severity-badge.tsx) | prop `severity: critical \| warning \| info \| neutral`. Use na **faixa de alertas ativos** (06_RECORD_PATTERN). |
| `MoneyAmount` (= MoneyCell canônico) | [src/components/ui/money-amount.tsx](../../src/components/ui/money-amount.tsx) | já `font-mono tabular-nums` + cores semânticas; modos `signed`/`debit-column`/`credit-column`/`plain`. **Não recriar.** `DualCurrencyAmount` (ARS+USD) virá no PR-004. |
| `Button` | [src/components/ui/button.tsx](../../src/components/ui/button.tsx) | já **text-first**; ações importantes usam variantes textuais (`default`/`outline`/...), nunca só ícone (G-03). Sizes `icon*` apenas para ações auxiliares. |

## 5. Exemplos
```tsx
// Status numa worklist
<StatusBadge tone="warning">Pendiente</StatusBadge>
<StatusBadge tone="success">Contabilizado</StatusBadge>
<StatusBadge tone="critical">Bloqueado</StatusBadge>

// Severidade num alerta de registro
<SeverityBadge severity="critical">Costo no cerrado</SeverityBadge>
```

## 6. Regras para PRs futuros
1. **Não** introduzir cores hex/oklch novas para status — usar os tokens acima.
2. **Não** recriar badges de status/severidade — usar `StatusBadge`/`SeverityBadge`.
3. Grids operacionais usam `density="dense"` (PR-003 torna default) e `StatusBadge` na coluna Status.
4. Valores monetários sempre via `MoneyAmount` (tabular).
5. Ações importantes com **texto** (G-03); ícone só como reforço.
6. Densidade alvo: **28-30 linhas/1080p**, linha 32px, cabeçalho 34px, fonte 13px.
