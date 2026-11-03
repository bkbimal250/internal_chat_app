#!/usr/bin/env bash
# Restore a pg_dump custom-format backup into company_chat only.
# Never deletes Docker volumes. Never touches other PostgreSQL databases.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_company_chat_database

DUMP="${1:-}"
MODE="${2:-}"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: ./deploy/restore.sh backups/postgres-YYYYMMDDTHHMMSSZ.dump [--replace-existing]" >&2
  echo "Default: restore into company_chat_restore_check for verification." >&2
  echo "--replace-existing writes into company_chat only." >&2
  exit 1
fi

if [[ "$DUMP" == *".example"* ]]; then
  echo "Refusing to restore from an example path." >&2
  exit 1
fi

target="company_chat_restore_check"
if [[ "$MODE" == "--replace-existing" ]]; then
  echo "This replaces objects inside company_chat. Other databases are not touched."
  printf 'Type REPLACE to continue: '
  read -r confirm
  if [[ "$confirm" != "REPLACE" ]]; then
    echo "Restore cancelled."
    exit 1
  fi
  target="company_chat"
fi

case "$target" in
  company_chat|company_chat_restore_check) ;;
  *)
    echo "Refusing restore into ${target}." >&2
    exit 1
    ;;
esac

restore_args=(
  -U "${POSTGRES_USER}"
  -d "${target}"
  --no-owner
  --clean
  --if-exists
)

if vps_mode; then
  host="${POSTGRES_DUMP_HOST:-127.0.0.1}"
  port="${POSTGRES_DUMP_PORT:-5432}"
  export PGPASSWORD="${POSTGRES_PASSWORD}"
  if [[ "$target" == "company_chat_restore_check" ]]; then
    psql -h "$host" -p "$port" -U "${POSTGRES_USER}" -d postgres \
      -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE \"${target}\" OWNER \"${POSTGRES_USER}\"" \
      || true
  fi
  pg_restore -h "$host" -p "$port" "${restore_args[@]}" < "$DUMP"
  unset PGPASSWORD
else
  if [[ "$target" == "company_chat_restore_check" ]]; then
    compose exec -T postgres psql -U "${POSTGRES_USER}" -d postgres \
      -v ON_ERROR_STOP=1 \
      -c "CREATE DATABASE \"${target}\" OWNER \"${POSTGRES_USER}\"" \
      || true
  fi
  compose exec -T postgres pg_restore "${restore_args[@]}" < "$DUMP"
fi

if [[ "$target" == "company_chat" ]]; then
  echo "Restored ${DUMP} into company_chat"
else
  echo "Verified restore of ${DUMP} into ${target}. Production database company_chat was not modified."
fi
