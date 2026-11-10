#!/usr/bin/env bash
# Restore the exact local API/Web image IDs recorded before a deploy.
# Never pulls remote tags. PostgreSQL, S3, host Nginx, and other containers are not touched.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env
require_deploy_safety

FROM_FAILURE=0
LOCAL_TAG=""
API_ID=""
WEB_ID=""

usage() {
  cat >&2 <<EOF
Usage: rollback.sh [--from-failure] [--local-tag TAG] [--api-id sha256:...] [--web-id sha256:...]

Restores recorded or explicitly verified local API/Web image identities.
Does not docker pull. Does not revert database schema.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-failure)
      FROM_FAILURE=1
      shift
      ;;
    --local-tag)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "--local-tag requires a local image tag" >&2
        exit 1
      fi
      LOCAL_TAG="$2"
      shift 2
      ;;
    --api-id)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "--api-id requires a local image ID (sha256:...)" >&2
        exit 1
      fi
      API_ID="$2"
      shift 2
      ;;
    --web-id)
      if [[ -z "${2:-}" || "$2" == --* ]]; then
        echo "--web-id requires a local image ID (sha256:...)" >&2
        exit 1
      fi
      WEB_ID="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ "$1" =~ ^sha- ]]; then
        echo "Refusing rollback by mutable git commit tag '$1'." >&2
        echo "That tag can be republished to a different image digest." >&2
        if [[ -f "$PREVIOUS_IMAGES_FILE" ]]; then
          echo "Recorded image IDs exist in ${PREVIOUS_IMAGES_FILE}. Run: ./deploy/rollback.sh" >&2
        elif [[ -f "$PREVIOUS_SHA_FILE" ]]; then
          print_legacy_previous_sha_help
        fi
        echo "To restore a verified local pin: ./deploy/rollback.sh --local-tag rollback-pre-s3-20261109" >&2
        exit 1
      fi
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -n "$API_ID" && -z "$WEB_ID" ]] || [[ -z "$API_ID" && -n "$WEB_ID" ]]; then
  echo "Both --api-id and --web-id are required when passing explicit image IDs." >&2
  exit 1
fi

restore_mode=""
if [[ -n "$LOCAL_TAG" ]]; then
  echo "Verifying local rollback tag ${LOCAL_TAG} without pulling" >&2
  if ! resolve_local_tag_image_ids "$LOCAL_TAG"; then
    echo "Rollback failed: local tag ${LOCAL_TAG} is not available for both API and Web." >&2
    exit 1
  fi
  restore_mode="local-tag"
elif [[ -n "$API_ID" && -n "$WEB_ID" ]]; then
  ROLLBACK_API_ID="$(normalize_image_id "$API_ID")"
  ROLLBACK_WEB_ID="$(normalize_image_id "$WEB_ID")"
  restore_mode="ids"
elif read_previous_images; then
  restore_mode="recorded"
else
  if [[ -f "$PREVIOUS_SHA_FILE" ]]; then
    print_legacy_previous_sha_help
  else
    echo "No recorded API/Web image IDs. Pass --local-tag or --api-id/--web-id." >&2
  fi
  exit 1
fi

echo "Rolling back application images to recorded local identities"
echo "API ${ROLLBACK_API_ID}"
echo "WEB ${ROLLBACK_WEB_ID}"
if [[ "$restore_mode" == "local-tag" ]]; then
  if ! restore_local_image_refs "$ROLLBACK_API_REF" "$ROLLBACK_WEB_REF"; then
    echo "Rollback failed while restoring local tag ${LOCAL_TAG}. Database schema was not reverted." >&2
    exit 1
  fi
elif ! restore_images_from_ids "$ROLLBACK_API_ID" "$ROLLBACK_WEB_ID"; then
  echo "Rollback failed while restoring recorded image IDs. Database schema was not reverted." >&2
  exit 1
fi

if ! "${HEALTHCHECK_SH:-$SCRIPT_DIR/healthcheck.sh}"; then
  echo "Rollback health checks failed after restoring local images. Database schema was not reverted." >&2
  exit 1
fi

if previous="$(read_tag_file "$PREVIOUS_SHA_FILE" || true)"; then
  record_deployed_tag "$previous"
fi

echo "Rollback restored local API/Web image identities. Database schema was not reverted."
if [[ "$FROM_FAILURE" -eq 1 ]]; then
  echo "Previous images restored after a failed deploy. Schema was not reverted."
fi
