#!/usr/bin/env bash
# Forward-only backup. Does not stop services or touch Docker volumes.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

mkdir -p backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="backups/postgres-${stamp}.dump"
compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --no-owner \
  --format=custom \
  > "$dump"
chmod 600 "$dump"

mapfile -t old < <(ls -1t backups/postgres-*.dump 2>/dev/null | tail -n +15 || true)
if ((${#old[@]})); then
  rm -f "${old[@]}"
fi

echo "Wrote ${dump}"
