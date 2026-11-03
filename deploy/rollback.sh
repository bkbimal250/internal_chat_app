#!/usr/bin/env bash
# Restore previous application images. PostgreSQL and S3 volumes are not touched.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

FROM_FAILURE=0
TAG="${1:-}"
if [[ "${TAG}" == "--from-failure" ]]; then
  FROM_FAILURE=1
  TAG=""
fi

if [[ -z "$TAG" && -f .previous-sha ]]; then
  TAG="$(tr -d '[:space:]' < .previous-sha)"
fi
if [[ -z "$TAG" ]]; then
  echo "No previous image tag is recorded. Pass sha-<git-sha> explicitly." >&2
  exit 1
fi

echo "Rolling back application images to ${TAG}"
"$ROOT_DIR/deploy/deploy.sh" "$TAG" --skip-migrate --no-rollback
echo "Rollback restored ${TAG}. Database schema was not reverted."
if [[ "$FROM_FAILURE" -eq 1 ]]; then
  exit 1
fi
