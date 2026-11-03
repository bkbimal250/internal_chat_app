#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

fail=0
check() {
  local name="$1"
  shift
  if "$@"; then
    echo "ok  ${name}"
  else
    echo "FAIL ${name}" >&2
    fail=1
  fi
}

check "api live" compose exec -T api node -e \
  "fetch('http://127.0.0.1:3001/health/live',{signal:AbortSignal.timeout(4000)}).then(async r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
check "api ready" compose exec -T api node -e \
  "fetch('http://127.0.0.1:3001/health/ready',{signal:AbortSignal.timeout(4000)}).then(async r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
check "worker live" compose exec -T retention-worker node -e \
  "fetch('http://127.0.0.1:3002/health/live',{signal:AbortSignal.timeout(4000)}).then(async r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
check "web live" compose exec -T web wget -qO- http://127.0.0.1:8080/healthz >/dev/null
if vps_mode; then
  echo "ok  postgres (host PostgreSQL; verified via api ready)"
else
  check "postgres" compose exec -T postgres pg_isready -U "${POSTGRES_USER:-company_chat}" -d "${POSTGRES_DB:-company_chat}"
fi
if storage_in_cluster; then
  check "storage" compose exec -T storage curl -fsS http://127.0.0.1:4566/_localstack/health >/dev/null
else
  echo "ok  storage (external S3; skipped in-cluster LocalStack check)"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Health checks failed" >&2
  exit 1
fi
echo "All health checks passed"
