#!/usr/bin/env bash
set -euo pipefail

echo "== SUNSET ERP: validação automática =="

PKG=""

if [ -f "pnpm-lock.yaml" ]; then
  PKG="pnpm"
elif [ -f "yarn.lock" ]; then
  PKG="yarn"
elif [ -f "package-lock.json" ]; then
  PKG="npm"
elif [ -f "package.json" ]; then
  PKG="npm"
else
  echo "package.json não encontrado. Pulando validação Node."
  exit 0
fi

echo "Package manager detectado: $PKG"

run_if_exists() {
  local script="$1"
  if jq -e ".scripts[\"$script\"]" package.json >/dev/null 2>&1; then
    echo "Rodando $PKG run $script"
    if [ "$PKG" = "pnpm" ]; then pnpm run "$script"; fi
    if [ "$PKG" = "npm" ]; then npm run "$script"; fi
    if [ "$PKG" = "yarn" ]; then yarn "$script"; fi
  else
    echo "Script '$script' não existe. Pulando."
  fi
}

run_if_exists lint
run_if_exists typecheck
run_if_exists test
run_if_exists build

echo "Validação concluída."
