#!/usr/bin/env bash
set -euo pipefail

if [ ! -d ".git" ]; then
  echo "Rode na raiz do repositório."
  exit 1
fi

echo "Abrindo Hermes na raiz do repositório."
echo "Cole o prompt: .ai/prompts/MASTER_AUTOPILOT_PROMPT.md"
hermes
