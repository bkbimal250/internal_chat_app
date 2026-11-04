#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-internal-chat}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE_LOCAL_S3_FILE="${COMPOSE_LOCAL_S3_FILE:-docker-compose.prod.local-s3.yml}"
COMPOSE_VPS_FILE="${COMPOSE_VPS_FILE:-docker-compose.prod.vps.yml}"

vps_mode() {
  case "${DEPLOY_TARGET:-}" in
    vps|host-postgres) return 0 ;;
  esac
  [[ "$(basename "${COMPOSE_FILE:-}")" == "docker-compose.prod.vps.yml" ]]
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
  local arg
  for arg in "$@"; do
    case "$arg" in
      down|build|prune|kill)
        echo "Refusing Compose command '${arg}'. Production never builds, downs, or prunes." >&2
        exit 2
        ;;
      --build|--volumes|-v)
        echo "Refusing a destructive Compose flag '${arg}'. Named volumes must stay intact and images must be pulled, not built." >&2
        exit 2
        ;;
    esac
  done
  local joined=" $* "
  if [[ "$joined" == *" volume prune "* || "$joined" == *" volume rm "* ]]; then
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
  local profile=()
  if vps_mode && retention_worker_enabled; then
    profile=(--profile retention)
  fi
  docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" "${files[@]}" "${profile[@]}" "$@"
}

retention_worker_enabled() {
  case "${RETENTION_WORKER_ENABLED:-}" in
    1|true|TRUE|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

app_services() {
  if vps_mode; then
    if retention_worker_enabled; then
      printf '%s\n' api web retention-worker
    else
      printf '%s\n' api web
    fi
  else
    printf '%s\n' api web retention-worker caddy
  fi
}

require_deploy_safety() {
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-internal-chat}"
  if [[ "$COMPOSE_PROJECT_NAME" != "internal-chat" ]]; then
    echo "COMPOSE_PROJECT_NAME must stay internal-chat (got: ${COMPOSE_PROJECT_NAME})." >&2
    exit 1
  fi
  case "${DEPLOY_TARGET:-}" in
    vps|host-postgres) ;;
    *)
      echo "DEPLOY_TARGET must be vps (got: ${DEPLOY_TARGET:-empty})." >&2
      exit 1
      ;;
  esac
  if [[ "$(basename "${COMPOSE_FILE:-}")" != "docker-compose.prod.vps.yml" ]]; then
    echo "COMPOSE_FILE must be docker-compose.prod.vps.yml (got: ${COMPOSE_FILE:-empty})." >&2
    exit 1
  fi
  local svc count=0
  while IFS= read -r svc; do
    [[ -z "$svc" ]] && continue
    count=$((count + 1))
    case "$svc" in
      api|web) ;;
      retention-worker)
        if ! retention_worker_enabled; then
          echo "retention-worker cannot start while RETENTION_WORKER_ENABLED is off." >&2
          exit 1
        fi
        ;;
      postgres|caddy|nginx|storage)
        echo "Refusing to recreate host or foreign service '${svc}'." >&2
        exit 1
        ;;
      *)
        echo "Refusing unknown Compose service '${svc}'. Only MiChat api/web are allowed." >&2
        exit 1
        ;;
    esac
  done < <(app_services)
  if ((count < 2)); then
    echo "Refusing deploy with no MiChat application services." >&2
    exit 1
  fi
}

require_deploy_user() {
  if [[ "$(id -u)" -eq 0 || "$(id -un)" == "root" ]]; then
    echo "Refusing to deploy as root. Use the deploy user so Docker uses that user's GHCR credentials in ~/.docker/config.json." >&2
    exit 1
  fi
  local expected="${DEPLOY_SSH_USER:-deploy}"
  if [[ "$(id -un)" != "$expected" ]]; then
    echo "Refusing to deploy as $(id -un). Expected ${expected} so GHCR credentials in that user's Docker config apply." >&2
    exit 1
  fi
  echo "Deploying as $(id -un); Docker config ${DOCKER_CONFIG:-$HOME/.docker}"
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-internal-chat}"
  if [[ "$COMPOSE_PROJECT_NAME" != "internal-chat" ]]; then
    echo "COMPOSE_PROJECT_NAME must stay internal-chat after load_env (got: ${COMPOSE_PROJECT_NAME})." >&2
    exit 1
  fi
  if vps_mode; then
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
