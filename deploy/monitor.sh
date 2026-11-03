#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

echo "== deployment =="
echo "project=${COMPOSE_PROJECT_NAME}"
echo "sha=${IMAGE_TAG:-unknown}"
echo "api_image=${API_IMAGE:-unknown}"
echo "web_image=${WEB_IMAGE:-unknown}"

echo
echo "== compose =="
compose ps

echo
echo "== restart counts =="
docker inspect --format '{{.Name}} restarts={{.RestartCount}} status={{.State.Status}}' \
  $(compose ps -q) 2>/dev/null || true

echo
echo "== resources =="
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}' \
  $(compose ps -q) 2>/dev/null || true

echo
echo "== docker disk =="
docker system df

echo
echo "== health =="
"$ROOT_DIR/deploy/healthcheck.sh" || true
