import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function findBash() {
  const candidates = [
    process.env.BASH,
    'bash',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ].filter(Boolean);
  for (const command of candidates) {
    if (command.includes('\\') && !existsSync(command)) continue;
    const result = spawnSync(command, ['-c', 'echo ok'], { encoding: 'utf8' });
    if (result.status === 0 && (result.stdout || '').includes('ok')) return command;
  }
  return null;
}

const bash = findBash();

function unixPath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function setupHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'michat-health-'));
  const hooks = join(dir, 'hooks');
  mkdirSync(hooks);
  writeFileSync(
    join(dir, '.env.production'),
    [
      'COMPOSE_PROJECT_NAME=internal-chat',
      'DEPLOY_TARGET=vps',
      'COMPOSE_FILE=docker-compose.prod.vps.yml',
      'PROD_ENV_FILE=.env.production',
      'POSTGRES_DB=company_chat',
      'RETENTION_WORKER_ENABLED=0',
      'API_IMAGE=ghcr.io/bkbimal250/internal_chat_app/api:sha-local-validate',
      'WEB_IMAGE=ghcr.io/bkbimal250/internal_chat_app/web:sha-local-validate',
      'IMAGE_TAG=sha-local-validate',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(hooks, 'container_is_running'),
    '#!/usr/bin/env bash\nexit 0\n',
  );
  return { dir, hooks, unixDir: unixPath(dir), unixHooks: unixPath(hooks) };
}

function runHarness(script, extraEnv = {}) {
  assert.ok(bash, 'bash is required for deploy health tests');
  const { dir, hooks, unixDir, unixHooks } = setupHarness();
  const result = spawnSync(bash, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOY_ROOT: unixDir,
      HEALTHCHECK_HOOKS: unixHooks,
      HEALTH_ATTEMPTS: '4',
      HEALTH_DELAY_SECONDS: '0',
      RUNNING_IMAGE_API: '',
      RUNNING_IMAGE_WEB: '',
      ...extraEnv,
      _HARNESS_DIR: unixDir,
      _HOOKS: unixHooks,
    },
  });
  return { result, dir, hooks, unixDir };
}

test(
  'API live retries through startup connection-refused then passes',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      cat > "$_HOOKS/http_probe" <<'HOOK'
nfile="\${HEALTHCHECK_HOOKS}/live-n"
n=$(( $(cat "$nfile" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$nfile"
if [ "$n" -lt 3 ]; then echo connection-refused; exit 1; fi
echo http-200
exit 0
HOOK
      wait_for_http_check "api live" api http://127.0.0.1:3001/health/live
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS {2}api live \(http-200\)/);
    assert.match(result.stdout, /WAIT {2}api live \(connection-refused\)/);
  },
);

test(
  'API ready retries HTTP 503 then passes',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      cat > "$_HOOKS/http_probe" <<'HOOK'
nfile="\${HEALTHCHECK_HOOKS}/ready-n"
n=$(( $(cat "$nfile" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$nfile"
if [ "$n" -lt 3 ]; then echo http-503; exit 1; fi
echo http-200
exit 0
HOOK
      wait_for_http_check "api ready" api http://127.0.0.1:3001/health/ready
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /WAIT {2}api ready \(http-503\)/);
    assert.match(result.stdout, /PASS {2}api ready \(http-200\)/);
  },
);

test(
  'API health-check timeout is classified and fails after bounded retries',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      cat > "$_HOOKS/http_probe" <<'HOOK'
echo timeout
exit 1
HOOK
      if wait_for_http_check "api live" api http://127.0.0.1:3001/health/live; then
        echo unexpected-pass
        exit 1
      fi
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /FAIL {2}api live \(timeout\)/);
    assert.match(result.stdout, /attempt 4\/4/);
  },
);

test(
  'Web health-check failure is reported distinctly',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      cat > "$_HOOKS/http_probe" <<'HOOK'
echo http-500
exit 1
HOOK
      if wait_for_http_check "web live" web http://127.0.0.1:8080/healthz; then
        echo unexpected-pass
        exit 1
      fi
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /FAIL {2}web live \(http-500\)/);
  },
);

test(
  'Successful retry after transient failures',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      cat > "$_HOOKS/http_probe" <<'HOOK'
nfile="\${HEALTHCHECK_HOOKS}/retry-n"
n=$(( $(cat "$nfile" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$nfile"
if [ "$n" -eq 1 ]; then echo container-not-running; exit 1; fi
if [ "$n" -eq 2 ]; then echo connection-refused; exit 1; fi
echo http-200
exit 0
HOOK
      wait_for_http_check "api live" api http://127.0.0.1:3001/health/live
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /PASS {2}api live \(http-200\)/);
  },
);

test(
  'Permanent health-check failure does not report success',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      cat > "$_HOOKS/http_probe" <<'HOOK'
echo connection-refused
exit 1
HOOK
      if wait_for_http_check "api ready" api http://127.0.0.1:3001/health/ready; then
        echo unexpected-pass
        exit 1
      fi
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /FAIL {2}api ready \(connection-refused\)/);
    assert.doesNotMatch(result.stdout, /All health checks passed/);
  },
);

test(
  'Missing previous deployment tag is not invented',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      if tag="$(discover_previous_tag sha-bbbbbbb)"; then
        echo "invented $tag"
        exit 1
      fi
      echo "missing-previous"
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /missing-previous/);
  },
);

test(
  'Previous image discovery prefers verified tag then running images',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      export RUNNING_IMAGE_API=ghcr.io/bkbimal250/internal_chat_app/api:sha-aaaaaaa
      export RUNNING_IMAGE_WEB=ghcr.io/bkbimal250/internal_chat_app/web:sha-aaaaaaa
      discovered="$(discover_previous_tag sha-bbbbbbb)"
      test "$discovered" = "sha-aaaaaaa"
      atomic_write "$DEPLOYED_SHA_FILE" sha-ccccccc
      discovered="$(discover_previous_tag sha-bbbbbbb)"
      test "$discovered" = "sha-ccccccc"
      echo discovered-ok
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /discovered-ok/);
  },
);

test(
  'Atomic deployment tracking writes the tag only through mv',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result, dir } = runHarness(`
      source deploy/lib.sh
      record_deployed_tag sha-ddddddd
      test "$(cat "$DEPLOYED_SHA_FILE")" = "sha-ddddddd"
      ls .deployed-sha.tmp.* >/dev/null 2>&1 && { echo leftover-temp; exit 1; }
      echo atomic-ok
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(join(dir, '.deployed-sha'), 'utf8').trim(), 'sha-ddddddd');
    assert.match(result.stdout, /atomic-ok/);
  },
);

test(
  'Rollback succeeds when previous tag and images are available',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      cat > "$_HARNESS_DIR/fake-deploy.sh" <<'HOOK'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$_HARNESS_DIR/rollback-args"
exit 0
HOOK
      chmod +x "$_HARNESS_DIR/fake-deploy.sh"
      export DEPLOY_SH="$_HARNESS_DIR/fake-deploy.sh"
      export ROLLBACK_IMAGE_CHECK=ok
      bash "$REPO/deploy/rollback.sh" sha-aaaaaaa
      grep -q 'sha-aaaaaaa --skip-migrate --no-rollback' "$_HARNESS_DIR/rollback-args"
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Rollback restored sha-aaaaaaa/);
    assert.match(result.stdout, /Database schema was not reverted/);
  },
);

test(
  'Failed rollback and missing previous tag stay visible as failures',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const missing = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      if bash "$REPO/deploy/rollback.sh"; then echo unexpected-pass; exit 1; fi
    `);
    assert.equal(missing.result.status, 0, `${missing.result.stdout}\n${missing.result.stderr}`);
    assert.match(`${missing.result.stdout}\n${missing.result.stderr}`, /No previous image tag is recorded/);

    const failed = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      cat > "$_HARNESS_DIR/fake-deploy.sh" <<'HOOK'
#!/usr/bin/env bash
exit 1
HOOK
      chmod +x "$_HARNESS_DIR/fake-deploy.sh"
      export DEPLOY_SH="$_HARNESS_DIR/fake-deploy.sh"
      export ROLLBACK_IMAGE_CHECK=ok
      if bash "$REPO/deploy/rollback.sh" sha-aaaaaaa; then echo unexpected-pass; exit 1; fi
    `);
    assert.equal(failed.result.status, 0, `${failed.result.stdout}\n${failed.result.stderr}`);
    assert.match(`${failed.result.stdout}\n${failed.result.stderr}`, /Rollback failed while restoring sha-aaaaaaa/);

    const unavailable = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      export ROLLBACK_IMAGE_CHECK=missing
      if bash "$REPO/deploy/rollback.sh" sha-aaaaaaa; then echo unexpected-pass; exit 1; fi
    `);
    assert.equal(unavailable.result.status, 0, `${unavailable.result.stdout}\n${unavailable.result.stderr}`);
    assert.match(`${unavailable.result.stdout}\n${unavailable.result.stderr}`, /not available/);
  },
);

test(
  'Retention worker stays disabled during VPS health checks',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      source deploy/lib.sh
      load_env
      RETENTION_WORKER_ENABLED=0
      retention_worker_enabled && exit 1
      services="$(app_services | tr '\\n' ' ')"
      test "$services" = "api web "
      echo worker-off
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /worker-off/);
  },
);
