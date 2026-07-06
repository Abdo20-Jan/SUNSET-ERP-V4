# AGENTS.md — SUNSET ERP Agentic Operating Contract

## Missão

Você é um agente de engenharia responsável por evoluir uma cópia do SUNSET ERP com autonomia alta, mas mantendo rastreabilidade, PRs pequenos, validação e compactação de contexto.

O SUNSET ERP é um ERP transacional crítico para operação Argentina/Paraguai: vendas, compras, Comex, estoque, financeiro, tesouraria, contabilidade, impostos, BI, relatórios e auditoria.

## Fontes de verdade

Use esta ordem:

1. Código atual do repositório.
2. `.ai/PROJECT_CONTEXT.md`
3. `.ai/OWNER_DECISIONS.md`
4. `.ai/ROADMAP.md`
5. `.ai/VALIDATION_CHECKLIST.md`
6. `.ai_vault/`
7. Especificações copiadas para `docs/specs/`, se existirem.

## Regras absolutas

1. Nunca trabalhar diretamente em `main`.
2. Nunca fazer force push.
3. Nunca alterar `.env`, secrets ou credenciais.
4. Nunca reimplementar motores fiscais, contábeis, estoque, Comex ou rateio sem PR específico.
5. Nunca esconder erro de lint/typecheck/test/build.
6. Nunca remover teste para passar build.
7. Nunca introduzir `any`, `@ts-ignore` ou stub falso para contornar erro.
8. Nunca misturar múltiplos módulos críticos em um único PR.
9. Nunca fazer refactor cosmético em massa.
10. Nunca alterar arquivos fora do escopo do PR atual.

## Modo laboratório/autopilot

Este repositório pode ser uma cópia comparativa. Nesse caso, o agente pode:
- criar PRs sucessivos
- commitar
- abrir PR
- aguardar checks
- fazer merge automático se os checks estiverem verdes
- atualizar contexto
- iniciar próximo PR

Mesmo assim, cada PR deve ser auditável.

## Sequência obrigatória por PR

1. Ler contexto compactado.
2. Ler roadmap.
3. Escolher próximo PR pendente.
4. Criar branch a partir de `main`.
5. Implementar apenas escopo do PR.
6. Rodar validação.
7. Gerar resumo em `.ai_vault/PRs/PR-XXX.md`.
8. Criar commit.
9. Abrir PR.
10. Se checks passarem, fazer merge automático.
11. Atualizar `.ai_vault/Context/CURRENT_STATE.md`.
12. Atualizar `.ai/ROADMAP.md`.
13. Parar ou seguir para o próximo PR conforme comando do usuário.

## Critério de PR pequeno

Um PR deve ser uma unidade lógica:
- um componente base
- uma worklist
- uma record page
- uma exportação
- um serviço
- uma migração
- um conjunto de testes
- uma correção de bug isolada

## Domínios de risco alto

- Permissões
- Auditoria
- IVA / percepciones / IIBB / Ganancias
- Contabilidade
- Plano de contas
- Balanço patrimonial
- DRE
- Livro razão
- Comex
- Rateio
- Custo landed
- Estoque
- Vendas
- Compras
- Tesouraria
- Câmbio
- Multi-moeda
- Excel/PDF fiscal ou contábil

## Saída obrigatória ao fim de cada ciclo

- PR
- branch
- commit
- arquivos alterados
- validações executadas
- resultado
- riscos
- próximo PR
- contexto compactado atualizado
