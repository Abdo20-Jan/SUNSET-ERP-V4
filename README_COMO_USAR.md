# SUNSET ERP — Agentic Autopilot Kit

Este kit foi feito para rodar em uma CÓPIA do ERP, com execução automática por PR:
- planeja roadmap
- executa PR por PR
- roda validações
- abre PR
- tenta merge automático quando checks passarem
- compacta contexto para Obsidian/Graphy
- continua para o próximo PR

Use somente em ambiente comparativo/laboratório. Para produção, mantenha revisão humana.

## Ordem

1. Copie a pasta `.ai` para a raiz do seu repositório.
2. Copie a pasta `scripts` para a raiz do seu repositório.
3. Rode:

```bash
chmod +x scripts/*.sh
./scripts/00_install_mac_base.sh
./scripts/01_prepare_repo.sh
```

4. Abra o Obsidian apontando para:

```text
SEU_REPO/.ai_vault
```

5. Abra o Hermes dentro da raiz do repositório:

```bash
hermes
```

6. Cole o conteúdo de:

```text
.ai/prompts/MASTER_AUTOPILOT_PROMPT.md
```

## Modo automático forte

O script `03_agent_cycle.sh` assume que o agente já implementou a mudança e apenas:
- valida
- cria commit
- abre PR
- tenta merge automático
- compacta contexto

Use assim:

```bash
./scripts/03_agent_cycle.sh PR-001 "audit-project-baseline" "docs(ai): establish project baseline"
```

## Segurança mínima

Mesmo no modo automático:
- nunca roda direto em `main`
- nunca faz force push
- bloqueia se encontrar `.env`, chaves ou secrets staged
- bloqueia se validações falharem
- bloqueia merge se checks falharem, salvo configuração explícita
