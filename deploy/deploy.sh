#!/usr/bin/env bash
# Pull and run prebuilt images. Never builds source. Never removes volumes.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_deploy_safety

TAG="${1:-}"
SKIP_MIGRATE=0
NO_ROLLBACK=0
if [[ $# -gt 0 ]]; then
  shift
fi
for arg in "$@"; do
  case "$arg" in
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --no-rollback) NO_ROLLBACK=1 ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

require_image_tag "$TAG"
require_deploy_user

if [[ "${ENV_FILE}" == *".example" ]]; then
  echo "Refusing to deploy with the example environment file. Copy it to .env.production first." >&2
  exit 1
fi

previous=""
if previous="$(record_previous_tag "$TAG")"; then
  true
else
  previous=""
fi

api_base="${API_IMAGE%:*}"
web_base="${WEB_IMAGE%:*}"
API_IMAGE="${api_base}:${TAG}"
WEB_IMAGE="${web_base}:${TAG}"
IMAGE_TAG="$TAG"
upsert_env API_IMAGE "$API_IMAGE"
upsert_env WEB_IMAGE "$WEB_IMAGE"
upsert_env IMAGE_TAG "$IMAGE_TAG"
load_env
require_deploy_safety

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  printf '%s\n' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-github}" --password-stdin
fi

echo "Backing up PostgreSQL before changing application images"
"$ROOT_DIR/deploy/backup.sh"

mapfile -t services < <(app_services)
require_deploy_safety
echo "Pulling ${API_IMAGE} and ${WEB_IMAGE} for ${services[*]}"
compose pull "${services[@]}"

if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  echo "Applying forward-only migrations"
  compose --profile migrate run --rm --no-deps migrate
fi

echo "Recreating application services only: ${services[*]}"
echo "Host Nginx and host PostgreSQL are not managed by Compose"
compose up -d --no-deps --no-build --pull never "${services[@]}"

if ! "$ROOT_DIR/deploy/healthcheck.sh"; then
  echo "Deployment health checks failed; not recording ${TAG} as deployed." >&2
  if [[ "$NO_ROLLBACK" -eq 0 && -n "${previous}" && "${previous}" != "${TAG}" ]]; then
    echo "Attempting rollback to ${previous}" >&2
    if ! "$ROOT_DIR/deploy/rollback.sh" "$previous"; then
      echo "Rollback failed; application images may still be ${TAG}. Database schema was not reverted." >&2
    else
      echo "Rollback restored ${previous}. Database schema was not reverted." >&2
    fi
  else
    echo "No previous verified image to restore; leaving ${TAG} in place." >&2
  fi
  exit 1
fi

record_deployed_tag "$TAG"
echo "Deployed ${TAG}"
