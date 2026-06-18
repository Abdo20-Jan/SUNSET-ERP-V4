#!/usr/bin/env bash
#
# Backup lógico de PRODUÇÃO (Railway / Postgres 18) via container Docker.
#
# Por quê via Docker: o servidor de prod roda Postgres 18; um `pg_dump` local
# mais antigo (ex.: Homebrew 16) aborta com "server version mismatch". A imagem
# `postgres:18-alpine` (a mesma dos testes) garante paridade de versão sem
# instalar nada no host. O mesmo método roda na GitHub Action `backup-prod.yml`.
#
# Uso:
#   pnpm db:backup:prod                          # lê DATABASE_URL de .env.local
#   DATABASE_URL="postgresql://…" pnpm db:backup:prod
#   BACKUP_DIR=/algum/dir pnpm db:backup:prod     # destino (default ~/sunset-backups)
#   RETENTION_DAYS=60 pnpm db:backup:prod         # poda backups locais > N dias (default 30)
#
# Restaurar (num Postgres 18 descartável p/ inspecionar, NUNCA direto em prod):
#   docker run -d --name pg-restore -e POSTGRES_PASSWORD=postgres \
#     -e POSTGRES_DB=restore -p 55433:5432 postgres:18-alpine
#   gunzip -c <arquivo>.sql.gz | docker exec -i pg-restore psql -U postgres -d restore
#
set -euo pipefail

IMAGE="postgres:18-alpine"
BACKUP_DIR="${BACKUP_DIR:-$HOME/sunset-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# 1) Resolve a connection string (env tem prioridade; senão .env.local).
URL="${DATABASE_URL:-}"
if [ -z "$URL" ] && [ -f .env.local ]; then
  URL="$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"')"
fi
if [ -z "$URL" ]; then
  echo "✗ DATABASE_URL não definida (passe via env ou tenha .env.local)." >&2
  exit 1
fi

# 2) Docker é obrigatório (pg_dump 18 vem da imagem).
if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker não está rodando (necessário para o pg_dump 18)." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/sunset-prod-${STAMP}.sql.gz"

echo "→ Backup de produção (Postgres 18 via Docker)"
echo "  destino: $OUT"

# 3) Dump comprimido. `-e PGURL` (sem valor) herda do ambiente exportado, então
#    a URL NÃO aparece na linha de comando do container (docker inspect/ps).
export PGURL="$URL"
docker run --rm -e PGURL "$IMAGE" \
  sh -c 'exec pg_dump "$PGURL" --no-owner --no-privileges' \
  | gzip >"$OUT"

# 4) Valida integridade do gzip + presença de dados-chave.
if ! gzip -t "$OUT" 2>/dev/null; then
  echo "✗ backup corrompido (gzip inválido): $OUT" >&2
  exit 1
fi
tables="$(gunzip -c "$OUT" | grep -c '^CREATE TABLE' || true)"
cuentas="$(gunzip -c "$OUT" | grep -c 'public."CuentaContable"' || true)"
if [ "$tables" -lt 1 ] || [ "$cuentas" -lt 1 ]; then
  echo "✗ backup suspeito (tabelas=$tables, CuentaContable=$cuentas)." >&2
  exit 1
fi
echo "✓ backup íntegro — tabelas: $tables · CuentaContable: ok · tamanho: $(du -h "$OUT" | cut -f1)"

# 5) Retenção: remove backups locais mais antigos que RETENTION_DAYS.
find "$BACKUP_DIR" -name 'sunset-prod-*.sql.gz' -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
