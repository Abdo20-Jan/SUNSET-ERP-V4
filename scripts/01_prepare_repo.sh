#!/usr/bin/env bash
set -euo pipefail

echo "== SUNSET ERP: preparar repositório =="

if [ ! -d ".git" ]; then
  echo "Erro: rode este script na raiz do repositório Git."
  exit 1
fi

mkdir -p .ai/prompts
mkdir -p .ai_vault/Context
mkdir -p .ai_vault/PRs
mkdir -p .ai_vault/Decisions
mkdir -p .ai_vault/Architecture
mkdir -p .ai_vault/Logs
mkdir -p docs/specs

if [ ! -f ".ai_vault/Context/CURRENT_STATE.md" ]; then
cat > .ai_vault/Context/CURRENT_STATE.md <<'EOF'
# CURRENT_STATE

Última atualização: inicial

## Estado atual

Baseline agentic criado. O agente deve atualizar este arquivo após cada PR.

## Último PR

Nenhum.

## Próximo PR sugerido

PR-001 — Baseline agentic e mapa do projeto.
EOF
fi

if [ ! -f ".ai_vault/Decisions/DECISIONS_LOG.md" ]; then
cat > .ai_vault/Decisions/DECISIONS_LOG.md <<'EOF'
# DECISIONS_LOG

## Decisões iniciais

- Ambiente tratado como cópia/laboratório comparativo.
- Autopilot pode executar PRs pequenos sucessivos.
- Merge automático só com validação local e GitHub checks verdes, salvo override explícito.
EOF
fi

if [ ! -f ".ai_vault/Architecture/PROJECT_MAP.md" ]; then
cat > .ai_vault/Architecture/PROJECT_MAP.md <<'EOF'
# PROJECT_MAP

Este arquivo deve ser preenchido pelo agente no PR-001.

## Framework

Pendente.

## Package manager

Pendente.

## Estrutura

Pendente.

## Comandos

Pendente.
EOF
fi

echo "Checando git..."
git status --short

echo "Se houver arquivos não rastreados .ai/.ai_vault/scripts, faça commit manual ou deixe o agente criar PR-001."
echo "Preparação concluída."
