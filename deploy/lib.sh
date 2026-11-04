#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${DEPLOY_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT_DIR"

HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-18}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-5}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-4}"
DEPLOYED_SHA_FILE="${DEPLOYED_SHA_FILE:-.deployed-sha}"
PREVIOUS_SHA_FILE="${PREVIOUS_SHA_FILE:-.previous-sha}"

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

atomic_write() {
  local dest="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp "${dest}.tmp.XXXXXX")"
  printf '%s\n' "$value" > "$tmp"
  mv -f "$tmp" "$dest"
}

normalize_tag() {
  local raw
  raw="$(printf '%s' "${1:-}" | tr -d '[:space:]')"
  if [[ "$raw" =~ ^sha-[0-9a-f]{7,40}$ || "$raw" == "sha-local-validate" ]]; then
    printf '%s\n' "$raw"
    return 0
  fi
  return 1
}

read_tag_file() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  normalize_tag "$(cat "$file")"
}

tag_from_image_ref() {
  local image="${1:-}"
  [[ -n "$image" ]] || return 1
  normalize_tag "${image##*:}"
}

running_compose_image() {
  local service="$1"
  if [[ "$service" == "api" && -n "${RUNNING_IMAGE_API+x}" ]]; then
    printf '%s\n' "${RUNNING_IMAGE_API}"
    return 0
  fi
  if [[ "$service" == "web" && -n "${RUNNING_IMAGE_WEB+x}" ]]; then
    printf '%s\n' "${RUNNING_IMAGE_WEB}"
    return 0
  fi
  compose ps -a --format '{{.Service}} {{.Image}}' 2>/dev/null | awk -v s="$service" '$1 == s { print $2; exit }' || true
}

discover_previous_tag() {
  local new_tag="${1:-}"
  local candidate=""
  if candidate="$(read_tag_file "$DEPLOYED_SHA_FILE")"; then
    if [[ "$candidate" != "$new_tag" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi
  local api_tag="" web_tag=""
  api_tag="$(tag_from_image_ref "$(running_compose_image api)" || true)"
  web_tag="$(tag_from_image_ref "$(running_compose_image web)" || true)"
  if [[ -n "$api_tag" && "$api_tag" != "$new_tag" ]]; then
    printf '%s\n' "$api_tag"
    return 0
  fi
  if [[ -n "$web_tag" && "$web_tag" != "$new_tag" ]]; then
    printf '%s\n' "$web_tag"
    return 0
  fi
  return 1
}

record_previous_tag() {
  local new_tag="$1"
  local previous=""
  if previous="$(discover_previous_tag "$new_tag")"; then
    atomic_write "$PREVIOUS_SHA_FILE" "$previous"
    echo "Previous image tag for rollback: ${previous}" >&2
    printf '%s\n' "$previous"
    return 0
  fi
  rm -f "$PREVIOUS_SHA_FILE"
  echo "No previous deployment tag; rollback will be skipped if this rollout fails." >&2
  return 1
}

record_deployed_tag() {
  local tag="$1"
  atomic_write "$DEPLOYED_SHA_FILE" "$tag"
}

rollback_target_images_available() {
  local tag="$1"
  local api_base="${API_IMAGE%:*}"
  local web_base="${WEB_IMAGE%:*}"
  if [[ "${ROLLBACK_IMAGE_CHECK:-}" == "missing" ]]; then
    echo "Rollback target images are not available for ${tag}." >&2
    return 1
  fi
  if [[ "${ROLLBACK_IMAGE_CHECK:-}" == "ok" ]]; then
    return 0
  fi
  if docker image inspect "${api_base}:${tag}" "${web_base}:${tag}" >/dev/null 2>&1; then
    return 0
  fi
  echo "Rollback target ${api_base}:${tag} / ${web_base}:${tag} not local; pulling"
  docker pull "${api_base}:${tag}"
  docker pull "${web_base}:${tag}"
}

health_sleep() {
  sleep "${HEALTH_DELAY_SECONDS}"
}

container_is_running() {
  local service="$1"
  if [[ -n "${HEALTHCHECK_HOOKS:-}" && -f "${HEALTHCHECK_HOOKS}/container_is_running" ]]; then
    bash "${HEALTHCHECK_HOOKS}/container_is_running" "$service"
    return
  fi
  local state
  state="$(compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$service" '$1 == s { print $2; exit }' || true)"
  [[ "$state" == "running" ]]
}

classify_probe_output() {
  local output="$1"
  local status="${2:-1}"
  local lower
  lower="$(printf '%s' "$output" | tr '[:upper:]' '[:lower:]')"
  if [[ "$lower" == *'container-not-running'* || "$lower" == *'is not running'* || "$lower" == *'no container'* ]]; then
    printf '%s\n' container-not-running
    return 1
  fi
  if [[ "$lower" == *'http-200'* || "$status" -eq 0 && "$lower" == *'http-200'* ]]; then
    printf '%s\n' http-200
    return 0
  fi
  if [[ "$lower" == *'timeout'* || "$lower" == *'timed out'* || "$lower" == *'aborterror'* ]]; then
    printf '%s\n' timeout
    return 1
  fi
  if [[ "$lower" == *'connection-refused'* || "$lower" == *'econnrefused'* ]]; then
    printf '%s\n' connection-refused
    return 1
  fi
  if [[ "$lower" =~ http-([0-9]{3}) ]]; then
    printf 'http-%s\n' "${BASH_REMATCH[1]}"
    return 1
  fi
  if [[ "$status" -eq 0 ]]; then
    printf '%s\n' http-200
    return 0
  fi
  printf '%s\n' error
  return 1
}

http_probe() {
  local service="$1"
  local url="$2"
  if [[ -n "${HEALTHCHECK_HOOKS:-}" && -f "${HEALTHCHECK_HOOKS}/http_probe" ]]; then
    bash "${HEALTHCHECK_HOOKS}/http_probe" "$service" "$url"
    return
  fi
  local output="" status=0 timeout_ms=$((HEALTH_TIMEOUT_SECONDS * 1000))
  if [[ "$service" == "web" ]]; then
    output="$(compose exec -T web wget -qO- --timeout="${HEALTH_TIMEOUT_SECONDS}" "$url" 2>&1)" || status=$?
    if [[ "$status" -eq 0 ]]; then
      printf '%s\n' http-200
      return 0
    fi
    classify_probe_output "$output" "$status"
    return 1
  fi
  output="$(
    compose exec -T "$service" node -e '
      const url = process.argv[1];
      const ms = Number(process.argv[2]);
      fetch(url, { signal: AbortSignal.timeout(ms) })
        .then((r) => {
          process.stdout.write("http-" + r.status + "\n");
          process.exit(r.ok ? 0 : 1);
        })
        .catch((error) => {
          const name = error && error.name;
          const message = String((error && error.message) || error);
          if (name === "TimeoutError" || name === "AbortError") process.stdout.write("timeout\n");
          else if (message.includes("ECONNREFUSED")) process.stdout.write("connection-refused\n");
          else process.stdout.write("error\n");
          process.exit(1);
        });
    ' "$url" "$timeout_ms" 2>&1
  )" || status=$?
  classify_probe_output "$output" "$status"
}

wait_for_http_check() {
  local name="$1"
  local service="$2"
  local url="$3"
  local attempt=1
  local reason="unknown"
  while ((attempt <= HEALTH_ATTEMPTS)); do
    echo "check ${name} attempt ${attempt}/${HEALTH_ATTEMPTS}"
    if ! container_is_running "$service"; then
      reason="container-not-running"
    elif reason="$(http_probe "$service" "$url")"; then
      echo "PASS  ${name} (${reason})"
      return 0
    else
      reason="${reason:-error}"
    fi
    echo "WAIT  ${name} (${reason})"
    if ((attempt == HEALTH_ATTEMPTS)); then
      echo "FAIL  ${name} (${reason})" >&2
      return 1
    fi
    health_sleep
    attempt=$((attempt + 1))
  done
  echo "FAIL  ${name} (${reason})" >&2
  return 1
}
