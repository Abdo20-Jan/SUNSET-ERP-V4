#!/usr/bin/env bash
# Cloud Agent install phase for SUNSET ERP v4.
#
# Idempotent, durable setup captured in the environment snapshot:
#   - PostgreSQL 18 (matches prod/Railway + the testcontainers image)
#   - a local cluster owned by the current user (no systemd needed)
#   - the "sunset_erp" database, schema (prisma migrate deploy) and seed
#   - node dependencies + generated Prisma client
#
# Per-boot startup (starting the postgres process) lives in start.sh.
set -euo pipefail

PG_MAJOR=18
PGBIN="/usr/lib/postgresql/${PG_MAJOR}/bin"
PGDATA="${SUNSET_PGDATA:-$HOME/.sunset-pgdata}"
PGPORT="${SUNSET_PGPORT:-5432}"
PGSOCK="/tmp"
DB_NAME="sunset_erp"
DB_USER="sunset"
DB_PASS="sunset"

echo "==> [1/6] Ensure PostgreSQL ${PG_MAJOR} is installed"
if [ ! -x "${PGBIN}/initdb" ]; then
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  sudo apt-get install -y -qq curl ca-certificates gnupg >/dev/null
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs 2>/dev/null || echo noble)-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq "postgresql-${PG_MAJOR}" "postgresql-client-${PG_MAJOR}" >/dev/null
fi
"${PGBIN}/postgres" --version

echo "==> [2/6] Initialize local cluster (if missing) at ${PGDATA}"
if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  mkdir -p "${PGDATA}"
  "${PGBIN}/initdb" -D "${PGDATA}" -U postgres \
    --auth-local=trust --auth-host=trust -E UTF8 >/dev/null
fi
# Configure listen address / port / socket dir idempotently.
sed -i '/^listen_addresses/d;/^port =/d;/^unix_socket_directories/d' "${PGDATA}/postgresql.conf"
cat >> "${PGDATA}/postgresql.conf" <<EOF
listen_addresses = 'localhost'
port = ${PGPORT}
unix_socket_directories = '${PGSOCK}'
EOF

echo "==> [3/6] Start PostgreSQL for setup"
if ! "${PGBIN}/pg_ctl" -D "${PGDATA}" status >/dev/null 2>&1; then
  "${PGBIN}/pg_ctl" -D "${PGDATA}" -l "${PGDATA}/server.log" -w start
fi

echo "==> [4/6] Ensure role + database exist"
"${PGBIN}/psql" -h "${PGSOCK}" -p "${PGPORT}" -U postgres -tc \
  "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  "${PGBIN}/psql" -h "${PGSOCK}" -p "${PGPORT}" -U postgres -c \
  "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}' SUPERUSER;"
"${PGBIN}/psql" -h "${PGSOCK}" -p "${PGPORT}" -U postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  "${PGBIN}/psql" -h "${PGSOCK}" -p "${PGPORT}" -U postgres -c \
  "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

echo "==> [5/6] Write .env (dev-only local credentials) if missing"
if [ ! -f .env ]; then
  SECRET="$(openssl rand -base64 32 2>/dev/null || echo dev-only-insecure-secret-change-me)"
  cat > .env <<EOF
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${PGPORT}/${DB_NAME}"
DIRECT_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${PGPORT}/${DB_NAME}"
AUTH_SECRET="${SECRET}"
AUTH_URL="http://localhost:3000"
NEXT_TELEMETRY_DISABLED="1"
EOF
fi

echo "==> [6/6] Install dependencies, apply schema and seed"
pnpm install --frozen-lockfile
pnpm prisma generate
pnpm db:migrate:deploy
pnpm db:seed

echo "==> install.sh complete. Dev login: admin / admin123"
