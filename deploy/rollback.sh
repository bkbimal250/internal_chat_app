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
  TAG="${2:-}"
fi

if [[ -z "$TAG" ]]; then
  TAG="$(read_tag_file "$PREVIOUS_SHA_FILE" || true)"
fi
if [[ -z "$TAG" ]]; then
  echo "No previous image tag is recorded. Pass sha-<git-sha> explicitly." >&2
  exit 1
fi

require_image_tag "$TAG"
echo "Verifying rollback target images for ${TAG} before restoring API and Web"
if ! rollback_target_images_available "$TAG"; then
  echo "Rollback failed: target API/Web images for ${TAG} are not available." >&2
  exit 1
fi

DEPLOY_SH="${DEPLOY_SH:-$ROOT_DIR/deploy/deploy.sh}"
echo "Rolling back application images to ${TAG}"
if ! "$DEPLOY_SH" "$TAG" --skip-migrate --no-rollback; then
  echo "Rollback failed while restoring ${TAG}. Database schema was not reverted." >&2
  exit 1
fi
echo "Rollback restored ${TAG}. Database schema was not reverted."
if [[ "$FROM_FAILURE" -eq 1 ]]; then
  echo "Previous images restored after a failed deploy. Schema was not reverted."
fi
