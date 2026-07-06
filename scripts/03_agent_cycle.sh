#!/usr/bin/env bash
set -euo pipefail

PR_ID="${1:-}"
SLUG="${2:-}"
COMMIT_MSG="${3:-}"

if [ -z "$PR_ID" ] || [ -z "$SLUG" ] || [ -z "$COMMIT_MSG" ]; then
  echo "Uso: ./scripts/03_agent_cycle.sh PR-001 short-slug \"feat(module): message\""
  exit 1
fi

BRANCH="$(echo "${PR_ID}-${SLUG}" | tr '[:upper:]' '[:lower:]')"

echo "== Ciclo agentic: $PR_ID / $BRANCH =="

if [ ! -d ".git" ]; then
  echo "Erro: rode na raiz do repositório."
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "Você está em main. O script criará branch nova."
else
  echo "Branch atual: $CURRENT_BRANCH"
fi

echo "Checando secrets staged/untracked..."
if git status --short | grep -E '(^..|^\?\?) .*(\.env|secret|credential|token|dump|\.pem|\.key)' >/dev/null 2>&1; then
  echo "Bloqueado: arquivo potencialmente sensível detectado no working tree."
  git status --short | grep -E '(^..|^\?\?) .*(\.env|secret|credential|token|dump|\.pem|\.key)' || true
  exit 1
fi

echo "Atualizando main..."
git fetch origin
git checkout main
git pull --ff-only origin main

if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH"
fi

echo "Rodando validação..."
./scripts/02_validate.sh

echo "Diff stat:"
git diff --stat || true

if [ -z "$(git status --short)" ]; then
  echo "Nenhuma alteração para commitar."
  exit 0
fi

mkdir -p .ai_vault/PRs .ai_vault/Context .ai_vault/Logs .ai

PR_NOTE=".ai_vault/PRs/${PR_ID}.md"
cat > "$PR_NOTE" <<EOF
# ${PR_ID} — ${SLUG}

## Data
$(date -u +"%Y-%m-%d %H:%M:%S UTC")

## Branch
${BRANCH}

## Commit message
${COMMIT_MSG}

## Arquivos alterados
\`\`\`
$(git diff --name-only)
\`\`\`

## Diff stat
\`\`\`
$(git diff --stat)
\`\`\`

## Validação
Rodado \`./scripts/02_validate.sh\`.

## Próximo passo
Acompanhar PR no GitHub e atualizar este arquivo após merge.
EOF

cat > .ai/pr-body.md <<EOF
## ${PR_ID} — ${SLUG}

### Resumo
PR gerado pelo fluxo agentic autopilot em ambiente comparativo.

### Escopo
Ver \`${PR_NOTE}\`.

### Arquivos alterados
\`\`\`
$(git diff --name-only)
\`\`\`

### Validação
- \`./scripts/02_validate.sh\` executado localmente.

### Riscos
- Revisar diff antes de aplicar em produção.
- Este fluxo é para cópia/laboratório comparativo.

### Rollback
Reverter o merge commit ou o squash commit deste PR.

### Contexto
Contexto compactado em \`${PR_NOTE}\`.
EOF

git add .
git commit -m "$COMMIT_MSG"
git push -u origin "$BRANCH"

echo "Criando PR..."
PR_URL="$(gh pr create --base main --head "$BRANCH" --title "${PR_ID}: ${SLUG}" --body-file .ai/pr-body.md)"
echo "$PR_URL"

echo "Aguardando checks..."
sleep 10

if gh pr checks "$BRANCH" --watch; then
  echo "Checks verdes. Fazendo merge squash com delete branch..."
  gh pr merge "$BRANCH" --squash --delete-branch --admin=false || gh pr merge "$BRANCH" --squash --delete-branch
else
  if [ "${ALLOW_MERGE_WITHOUT_CHECKS:-false}" = "true" ]; then
    echo "Checks ausentes/falhos, mas ALLOW_MERGE_WITHOUT_CHECKS=true. Tentando merge."
    gh pr merge "$BRANCH" --squash --delete-branch
  else
    echo "Merge bloqueado: checks não passaram ou ausentes."
    exit 1
  fi
fi

git checkout main
git pull --ff-only origin main

cat > .ai_vault/Context/CURRENT_STATE.md <<EOF
# CURRENT_STATE

Última atualização: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

## Último PR processado
[[${PR_ID}]]

## Branch
${BRANCH}

## Status
Merge tentado/concluído pelo fluxo agentic. Ver GitHub para confirmação final.

## Próximo passo
Selecionar próximo PR pendente em [[ROADMAP]].
EOF

echo "Ciclo concluído."
