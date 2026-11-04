#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

fail=0
run_check() {
  if wait_for_http_check "$@"; then
    return 0
  fi
  fail=1
}

run_check "api live" api http://127.0.0.1:3001/health/live
run_check "api ready" api http://127.0.0.1:3001/health/ready
if retention_worker_enabled || ! vps_mode; then
  run_check "worker live" retention-worker http://127.0.0.1:3002/health/live
else
  echo "ok  worker (not started; RETENTION_WORKER_ENABLED is off)"
fi
run_check "web live" web http://127.0.0.1:8080/healthz
if vps_mode; then
  echo "ok  postgres (host PostgreSQL; verified via api ready)"
else
  if compose exec -T postgres pg_isready -U "${POSTGRES_USER:-company_chat}" -d "${POSTGRES_DB:-company_chat}"; then
    echo "PASS  postgres"
  else
    echo "FAIL  postgres" >&2
    fail=1
  fi
fi
if storage_in_cluster; then
  echo "checking in-cluster storage"
  if ! compose exec -T storage curl -fsS http://127.0.0.1:4566/_localstack/health >/dev/null; then
    echo "FAIL  storage" >&2
    fail=1
  else
    echo "PASS  storage"
  fi
else
  echo "ok  storage (external S3; skipped in-cluster LocalStack check)"
fi

if [[ "$fail" -ne 0 ]]; then
  echo "Health checks failed" >&2
  exit 1
fi
echo "All health checks passed"
