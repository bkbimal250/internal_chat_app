#!/usr/bin/env bash
# Pull and run prebuilt images. Never builds source. Never removes volumes.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

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

if [[ "${ENV_FILE}" == *".example" ]]; then
  echo "Refusing to deploy with the example environment file. Copy it to .env.production first." >&2
  exit 1
fi

previous="${IMAGE_TAG:-}"
if [[ -f .deployed-sha ]]; then
  previous="$(tr -d '[:space:]' < .deployed-sha)"
  printf '%s\n' "$previous" > .previous-sha
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

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  printf '%s\n' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USERNAME:-github}" --password-stdin
fi

echo "Backing up PostgreSQL before changing application images"
"$ROOT_DIR/deploy/backup.sh"

echo "Pulling ${API_IMAGE} and ${WEB_IMAGE}"
compose pull api web retention-worker

if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  echo "Applying forward-only migrations"
  compose --profile migrate run --rm --no-deps migrate
fi

mapfile -t services < <(app_services)
echo "Recreating application services only: ${services[*]}"
if vps_mode; then
  echo "Host Nginx and host PostgreSQL are not managed by Compose"
fi
compose up -d --no-deps --no-build --pull never "${services[@]}"

if ! "$ROOT_DIR/deploy/healthcheck.sh"; then
  echo "Deployment health checks failed; restoring ${previous:-previous images}" >&2
  if [[ "$NO_ROLLBACK" -eq 0 && -n "${previous}" && "${previous}" != "${TAG}" ]]; then
    "$ROOT_DIR/deploy/rollback.sh" --from-failure || true
  fi
  exit 1
fi

printf '%s\n' "$TAG" > .deployed-sha
echo "Deployed ${TAG}"
