#!/usr/bin/env bash
# Restore a pg_dump custom-format backup. Never deletes Docker volumes.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

DUMP="${1:-}"
MODE="${2:-}"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: ./deploy/restore.sh backups/postgres-YYYYMMDDTHHMMSSZ.dump [--replace-existing]" >&2
  echo "Default: restore into ${POSTGRES_DB:-company_chat}_restore_check for verification." >&2
  echo "--replace-existing writes into ${POSTGRES_DB:-company_chat}. It does not drop volumes." >&2
  exit 1
fi

if [[ "$DUMP" == *".example"* ]]; then
  echo "Refusing to restore from an example path." >&2
  exit 1
fi

target="${POSTGRES_DB}_restore_check"
if [[ "$MODE" == "--replace-existing" ]]; then
  echo "This replaces objects inside ${POSTGRES_DB}. Named volumes are not deleted."
  printf 'Type REPLACE to continue: '
  read -r confirm
  if [[ "$confirm" != "REPLACE" ]]; then
    echo "Restore cancelled."
    exit 1
  fi
  target="${POSTGRES_DB}"
  compose exec -T postgres pg_restore \
    -U "${POSTGRES_USER}" \
    -d "${target}" \
    --no-owner \
    --clean \
    --if-exists \
    < "$DUMP"
  echo "Restored ${DUMP} into ${target}"
  exit 0
fi

compose exec -T postgres psql -U "${POSTGRES_USER}" -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"${target}\" OWNER \"${POSTGRES_USER}\"" \
  || true
compose exec -T postgres pg_restore \
  -U "${POSTGRES_USER}" \
  -d "${target}" \
  --no-owner \
  --clean \
  --if-exists \
  < "$DUMP"
echo "Verified restore of ${DUMP} into ${target}. Production database ${POSTGRES_DB} was not modified."
