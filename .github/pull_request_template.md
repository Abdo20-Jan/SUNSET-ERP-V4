## O que muda

<!-- Resumo curto: o que esse PR faz e por quê. Aceita 2-4 linhas. -->

## Tipo

- [ ] feat — funcionalidade nova
- [ ] fix — correção de bug
- [ ] refactor — sem mudança de comportamento
- [ ] perf — performance
- [ ] chore — infra / processo / deps
- [ ] docs — só documentação

## Escopo

- [ ] Mudança schema-bound (toca `prisma/`) → exige owner approval e migration plan
- [ ] Server Action / route handler novo
- [ ] Componente cliente (`"use client"`) → ler memória `feedback_use_client_pure_exports.md`
- [ ] Toca `src/lib/services/` ou `src/lib/actions/` (alta sensibilidade)
- [ ] Cálculo monetário → usa `decimal.js` (não `Number`)
- [ ] Nada do acima

## Checklist pré-merge

- [ ] `pnpm lint && pnpm typecheck && pnpm build` passa local
- [ ] `pnpm biome:check` passa
- [ ] Nenhum novo issue Critical/High introduzido no Codacy (verificar PR check)
- [ ] Sem diminuição de coverage relevante (quando aplicável)
- [ ] Sem nova duplicação ≥ 50 linhas
- [ ] Cálculos com data usam `PeriodoContable` corretamente (memória: `fechaFin` 23:59:59.999 UTC + truncar lookup)
- [ ] Listagens de pendentes têm cross-check com ledger quando aplicável
- [ ] Migration: `pnpm db:push` testado em DB local + plano de rollback descrito abaixo

## Como testar

<!-- Caminho mínimo: rotas, telas, fluxos manuais ou comandos. -->

## Plano de rollback

<!-- Para mudanças schema-bound ou que tocam services/actions críticos. -->

## Referências

<!-- Issue, ADR, doc Codacy, conversa relevante. -->
