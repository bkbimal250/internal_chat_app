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
PREVIOUS_IMAGES_FILE="${PREVIOUS_IMAGES_FILE:-.previous-images}"
LOCAL_ROLLBACK_TAG="${LOCAL_ROLLBACK_TAG:-local-rollback}"

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
  if [[ -n "${COMPOSE_HOOKS:-}" && -f "${COMPOSE_HOOKS}/compose" ]]; then
    bash "${COMPOSE_HOOKS}/compose" "$@"
    return
  fi
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
  if [[ "${DEPLOY_HARNESS:-}" == "1" ]]; then
    echo "Deploy harness: skipping deploy-user check"
    return 0
  fi
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

running_compose_image_id() {
  local service="$1"
  if [[ "$service" == "api" && -n "${RUNNING_IMAGE_ID_API:-}" ]]; then
    printf '%s\n' "${RUNNING_IMAGE_ID_API}"
    return 0
  fi
  if [[ "$service" == "web" && -n "${RUNNING_IMAGE_ID_WEB:-}" ]]; then
    printf '%s\n' "${RUNNING_IMAGE_ID_WEB}"
    return 0
  fi
  local cid=""
  cid="$(compose ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$cid" ]]; then
    return 1
  fi
  docker inspect --format '{{.Image}}' "$cid" 2>/dev/null
}

normalize_image_id() {
  local raw
  raw="$(printf '%s' "${1:-}" | tr -d '[:space:]')"
  if [[ "$raw" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf '%s\n' "$raw"
    return 0
  fi
  return 1
}

image_repository() {
  local ref="${1:-}"
  [[ -n "$ref" ]] || return 1
  if [[ "$ref" == *@* ]]; then
    printf '%s\n' "${ref%@*}"
    return 0
  fi
  printf '%s\n' "${ref%:*}"
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
    echo "Previous image tag recorded for operators: ${previous}" >&2
    echo "Rollback restores image IDs from ${PREVIOUS_IMAGES_FILE}, not this mutable tag." >&2
    printf '%s\n' "$previous"
    return 0
  fi
  if [[ -f "$PREVIOUS_SHA_FILE" ]]; then
    echo "Keeping existing ${PREVIOUS_SHA_FILE}; new tag matches the running/deployed tag." >&2
    echo "Rollback uses recorded image IDs in ${PREVIOUS_IMAGES_FILE}." >&2
    cat "$PREVIOUS_SHA_FILE"
    return 0
  fi
  echo "No previous deployment tag file; rollback still uses recorded image IDs if available." >&2
  return 1
}

record_deployed_tag() {
  local tag="$1"
  atomic_write "$DEPLOYED_SHA_FILE" "$tag"
}

atomic_write_file() {
  local dest="$1"
  local tmp
  tmp="$(mktemp "${dest}.tmp.XXXXXX")"
  cat > "$tmp"
  mv -f "$tmp" "$dest"
}

write_previous_images() {
  local api_id="$1"
  local web_id="$2"
  printf 'api=%s\nweb=%s\n' "$api_id" "$web_id" | atomic_write_file "$PREVIOUS_IMAGES_FILE"
}

read_previous_images() {
  local file="${1:-$PREVIOUS_IMAGES_FILE}"
  [[ -f "$file" ]] || return 1
  local api_id="" web_id="" line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      api) api_id="$value" ;;
      web) web_id="$value" ;;
    esac
  done < "$file"
  api_id="$(normalize_image_id "$api_id" || true)"
  web_id="$(normalize_image_id "$web_id" || true)"
  if [[ -z "$api_id" || -z "$web_id" ]]; then
    return 1
  fi
  ROLLBACK_API_ID="$api_id"
  ROLLBACK_WEB_ID="$web_id"
  return 0
}

record_previous_images() {
  local api_id="" web_id=""
  api_id="$(normalize_image_id "$(running_compose_image_id api || true)" || true)"
  web_id="$(normalize_image_id "$(running_compose_image_id web || true)" || true)"
  if [[ -z "$api_id" || -z "$web_id" ]]; then
    echo "Could not record running API/Web image IDs; automatic rollback will be skipped if this rollout fails." >&2
    return 1
  fi
  write_previous_images "$api_id" "$web_id"
  echo "Recorded running image IDs for rollback: api=${api_id} web=${web_id}" >&2
  return 0
}

print_missing_rollback_image_help() {
  local api_id="${1:-unknown}"
  local web_id="${2:-unknown}"
  cat >&2 <<EOF
Rollback failed: recorded API/Web image IDs are not present locally.
Do not docker pull a git SHA tag; a CD retry can republish that tag as a different image.

Recorded:
  api=${api_id}
  web=${web_id}

If these images were preserved with a local pin (for example rollback-pre-s3-20261109):
  ./deploy/rollback.sh --local-tag rollback-pre-s3-20261109

Or pass the exact local image IDs:
  ./deploy/rollback.sh --api-id ${api_id} --web-id ${web_id}
EOF
}

print_legacy_previous_sha_help() {
  local tag=""
  tag="$(tr -d '[:space:]' < "$PREVIOUS_SHA_FILE" 2>/dev/null || true)"
  cat >&2 <<EOF
No recorded API/Web image IDs in ${PREVIOUS_IMAGES_FILE}.
A legacy tag file ${PREVIOUS_SHA_FILE} contains: ${tag:-empty}

Do not docker pull that git SHA tag. A CD retry can republish it as a different image.

Restore a verified local pin instead, for example:
  ./deploy/rollback.sh --local-tag rollback-pre-s3-20261109

Or pass the exact local image IDs:
  ./deploy/rollback.sh --api-id sha256:<api-id> --web-id sha256:<web-id>
EOF
}

image_id_exists_locally() {
  local id="$1"
  case "${ROLLBACK_IMAGE_CHECK:-}" in
    missing)
      echo "Rollback target images are not available for ${id}." >&2
      return 1
      ;;
    ok)
      return 0
      ;;
  esac
  if [[ -n "${LOCAL_IMAGE_IDS:-}" ]]; then
    case " ${LOCAL_IMAGE_IDS} " in
      *" ${id} "*) return 0 ;;
      *) return 1 ;;
    esac
  fi
  docker image inspect "$id" >/dev/null 2>&1
}

inspect_local_image_id() {
  local ref="$1"
  if [[ -n "${LOCAL_TAG_API_ID:-}" && "$ref" == *"/api:"* ]]; then
    printf '%s\n' "${LOCAL_TAG_API_ID}"
    return 0
  fi
  if [[ -n "${LOCAL_TAG_WEB_ID:-}" && "$ref" == *"/web:"* ]]; then
    printf '%s\n' "${LOCAL_TAG_WEB_ID}"
    return 0
  fi
  docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null
}

tag_local_image() {
  local id="$1"
  local ref="$2"
  if [[ "${DOCKER_TAG_STUB:-}" == "ok" ]]; then
    echo "Tagged ${id} as ${ref} (local only)" >&2
    return 0
  fi
  docker tag "$id" "$ref"
}

require_local_rollback_images() {
  local api_id="$1"
  local web_id="$2"
  if image_id_exists_locally "$api_id" && image_id_exists_locally "$web_id"; then
    return 0
  fi
  print_missing_rollback_image_help "$api_id" "$web_id"
  return 1
}

restore_local_image_refs() {
  local api_ref="$1"
  local web_ref="$2"
  upsert_env API_IMAGE "$api_ref"
  upsert_env WEB_IMAGE "$web_ref"
  load_env
  require_deploy_safety
  local services=()
  mapfile -t services < <(app_services)
  echo "Restoring local images without pulling: ${api_ref} ${web_ref}"
  echo "Host Nginx and host PostgreSQL are not managed by Compose"
  compose up -d --no-deps --no-build --pull never "${services[@]}"
}

restore_images_from_ids() {
  local api_id="$1"
  local web_id="$2"
  api_id="$(normalize_image_id "$api_id")"
  web_id="$(normalize_image_id "$web_id")"
  require_local_rollback_images "$api_id" "$web_id" || return 1
  local api_repo web_repo
  api_repo="$(image_repository "${API_IMAGE}")"
  web_repo="$(image_repository "${WEB_IMAGE}")"
  tag_local_image "$api_id" "${api_repo}:${LOCAL_ROLLBACK_TAG}"
  tag_local_image "$web_id" "${web_repo}:${LOCAL_ROLLBACK_TAG}"
  restore_local_image_refs "${api_repo}:${LOCAL_ROLLBACK_TAG}" "${web_repo}:${LOCAL_ROLLBACK_TAG}"
}

resolve_local_tag_image_ids() {
  local tag="$1"
  local api_repo web_repo api_id web_id
  api_repo="$(image_repository "${API_IMAGE}")"
  web_repo="$(image_repository "${WEB_IMAGE}")"
  api_id="$(normalize_image_id "$(inspect_local_image_id "${api_repo}:${tag}" || true)" || true)"
  web_id="$(normalize_image_id "$(inspect_local_image_id "${web_repo}:${tag}" || true)" || true)"
  if [[ -z "$api_id" || -z "$web_id" ]]; then
    echo "Local rollback tag '${tag}' is not present for both API and Web. Refusing to pull it from a registry." >&2
    echo "Inspect local images, then retag the verified pair or pass --api-id/--web-id." >&2
    return 1
  fi
  ROLLBACK_API_ID="$api_id"
  ROLLBACK_WEB_ID="$web_id"
  ROLLBACK_API_REF="${api_repo}:${tag}"
  ROLLBACK_WEB_REF="${web_repo}:${tag}"
  return 0
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
