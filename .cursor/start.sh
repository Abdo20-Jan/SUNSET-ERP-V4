#!/usr/bin/env bash
# Cloud Agent per-boot start phase for SUNSET ERP v4.
# Only reconciles runtime state: start the PostgreSQL process that install.sh
# initialized. It must be idempotent and must return (no foreground process).
set -euo pipefail

PG_MAJOR=18
PGBIN="/usr/lib/postgresql/${PG_MAJOR}/bin"
PGDATA="${SUNSET_PGDATA:-$HOME/.sunset-pgdata}"

if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  echo "start.sh: cluster missing at ${PGDATA}; run install.sh first" >&2
  exit 1
fi

if "${PGBIN}/pg_ctl" -D "${PGDATA}" status >/dev/null 2>&1; then
  echo "start.sh: PostgreSQL already running"
else
  "${PGBIN}/pg_ctl" -D "${PGDATA}" -l "${PGDATA}/server.log" -w start
  echo "start.sh: PostgreSQL started"
fi
