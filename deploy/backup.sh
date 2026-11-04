#!/usr/bin/env bash
# Forward-only backup of the company_chat database only.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_company_chat_database

mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="backups/postgres-${stamp}.dump"

dump_args=(
  -U "${POSTGRES_USER}"
  -d "${POSTGRES_DB}"
  --no-owner
  --format=custom
)

if vps_mode; then
  host="${POSTGRES_DUMP_HOST:-127.0.0.1}"
  port="${POSTGRES_DUMP_PORT:-5432}"
  echo "Dumping host PostgreSQL ${POSTGRES_DB} from ${host}:${port}"
  PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h "$host" -p "$port" "${dump_args[@]}" > "$dump"
else
  compose exec -T postgres pg_dump "${dump_args[@]}" > "$dump"
fi
if [[ ! -s "$dump" ]]; then
  echo "PostgreSQL backup produced an empty dump; refusing to continue." >&2
  rm -f "$dump"
  exit 1
fi
chmod 600 "$dump"

mapfile -t old < <(ls -1t backups/postgres-*.dump 2>/dev/null | tail -n +15 || true)
if ((${#old[@]})); then
  rm -f "${old[@]}"
fi

echo "Wrote ${dump}"
