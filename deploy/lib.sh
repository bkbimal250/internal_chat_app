#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-internal-chat}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_LOCAL_S3_FILE="${COMPOSE_LOCAL_S3_FILE:-docker-compose.prod.local-s3.yml}"
COMPOSE_VPS_FILE="${COMPOSE_VPS_FILE:-docker-compose.prod.vps.yml}"
if [[ "$COMPOSE_PROJECT_NAME" != "internal-chat" ]]; then
  echo "COMPOSE_PROJECT_NAME must stay internal-chat." >&2
  exit 1
fi

vps_mode() {
  case "${DEPLOY_TARGET:-}" in
    vps|host-postgres) return 0 ;;
  esac
  [[ "${COMPOSE_FILE}" == *prod.vps.yml ]]
}

storage_in_cluster() {
  if vps_mode; then
    return 1
  fi
  case "${STORAGE_IN_CLUSTER:-}" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

require_company_chat_database() {
  if [[ "${POSTGRES_DB:-}" != "company_chat" ]]; then
    echo "Refusing database work: POSTGRES_DB must be company_chat (got: ${POSTGRES_DB:-empty})." >&2
    exit 1
  fi
}

if [[ -n "${PROD_ENV_FILE:-}" && -f "${PROD_ENV_FILE}" ]]; then
  ENV_FILE="$PROD_ENV_FILE"
elif [[ -f .env.production ]]; then
  ENV_FILE=".env.production"
elif [[ -f deploy/.env.production ]]; then
  ENV_FILE="deploy/.env.production"
else
  ENV_FILE="deploy/.env.production.example"
fi

refuse_destructive() {
  local joined=" $* "
  if [[ "$joined" == *" -v "* || "$joined" == *" --volumes "* || "$joined" == *" volume prune "* ]]; then
    echo "Refusing a volume-destructive command. Named volumes must stay intact." >&2
    exit 2
  fi
}

compose() {
  refuse_destructive "$@"
  local files=(-f "$COMPOSE_FILE")
  if storage_in_cluster; then
    files+=(-f "$COMPOSE_LOCAL_S3_FILE")
  fi
  docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" "${files[@]}" "$@"
}

app_services() {
  if vps_mode; then
    printf '%s\n' api web retention-worker
  else
    printf '%s\n' api web retention-worker caddy
  fi
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-internal-chat}"
  if vps_mode && [[ "$COMPOSE_FILE" != *vps.yml ]]; then
    COMPOSE_FILE="$COMPOSE_VPS_FILE"
  fi
  COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
}

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

require_image_tag() {
  local tag="${1:-}"
  if [[ ! "$tag" =~ ^sha-[0-9a-f]{7,40}$ && "$tag" != "sha-local-validate" ]]; then
    echo "Image tag must look like sha-<git-sha> (received: ${tag:-empty})" >&2
    exit 1
  fi
}
