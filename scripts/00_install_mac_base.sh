#!/usr/bin/env bash
set -euo pipefail

echo "== SUNSET ERP: instalação base macOS =="

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew não encontrado. Instalando..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "Homebrew OK"
fi

brew update

echo "Instalando ferramentas base..."
brew install git gh node pnpm ripgrep jq direnv || true

echo "Instalando Hermes Agent..."
if ! command -v hermes >/dev/null 2>&1; then
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
else
  echo "Hermes já encontrado"
fi

echo "Versões:"
git --version || true
gh --version || true
node --version || true
pnpm --version || true
rg --version || true
jq --version || true
hermes --version || true

echo "Agora rode: gh auth login"
