#!/usr/bin/env bash
# Decision helper for GitHub Actions CD. No SSH, images, or Compose.
set -euo pipefail

require_main_ref() {
  local ref="${GITHUB_REF:-}"
  local event="${GITHUB_EVENT_NAME:-}"
  local head_ref="${GITHUB_HEAD_REF:-}"
  if [[ "$event" == "pull_request" || -n "$head_ref" ]]; then
    echo "Production CD cannot run from a pull request." >&2
    return 1
  fi
  if [[ "$ref" != "refs/heads/main" ]]; then
    echo "Production CD is limited to the main branch (got ${ref:-empty})." >&2
    return 1
  fi
  return 0
}

deploy_authorized() {
  local event="${GITHUB_EVENT_NAME:-}"
  local flag="${DEPLOY_ENABLED:-}"
  local once="${DEPLOY_ONCE:-}"
  if [[ "$event" == "push" && "$flag" == "true" ]]; then
    echo "authorized=auto-push"
    return 0
  fi
  if [[ "$event" == "workflow_dispatch" && "$once" == "true" ]]; then
    echo "authorized=deploy-once"
    return 0
  fi
  echo "Production deploy skipped (event=${event:-empty} DEPLOY_ENABLED=${flag:-unset} deploy_once=${once:-n/a})." >&2
  return 1
}

case "${1:-}" in
  require-main)
    require_main_ref
    ;;
  should-deploy)
    require_main_ref
    deploy_authorized
    ;;
  *)
    echo "Usage: cd-gate.sh require-main|should-deploy" >&2
    exit 2
    ;;
esac
