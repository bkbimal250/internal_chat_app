import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const PRODUCTION_API_ID = 'sha256:c63ade62bef6c671c7b774cdb3adfc3a9a9a672c431bc967633f1b2bfeb331cd';
const PRODUCTION_WEB_ID = 'sha256:5aa8158c7ae0e330a7747bf64c9c0107a9f485fb3241bc241b81e8bb980756c1';
const REPUBLISHED_API_ID = 'sha256:ad7c9b33622512edaca6510daa302b6b19934167dcaf1098d288319de3e53461';

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function setupHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'michat-health-'));
  const hooks = join(dir, 'hooks');
  const composeHooks = join(dir, 'compose-hooks');
  mkdirSync(hooks);
  mkdirSync(composeHooks);
  writeFileSync(
    join(dir, '.env.production'),
    [
      'COMPOSE_PROJECT_NAME=internal-chat',
      'DEPLOY_TARGET=vps',
      'COMPOSE_FILE=docker-compose.prod.vps.yml',
      'PROD_ENV_FILE=.env.production',
      'POSTGRES_DB=company_chat',
      'RETENTION_WORKER_ENABLED=0',
      'CHAT_ATTACHMENTS_ENABLED=false',
      'CALLS_ENABLED=false',
      'API_IMAGE=ghcr.io/bkbimal250/internal_chat_app/api:sha-f27c257',
      'WEB_IMAGE=ghcr.io/bkbimal250/internal_chat_app/web:sha-f27c257',
      'IMAGE_TAG=sha-f27c257',
      '',
    ].join('\n'),
  );
  writeExecutable(join(hooks, 'container_is_running'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(
    join(composeHooks, 'compose'),
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "${DEPLOY_ROOT}/compose.log"\nexit 0\n',
  );
  writeExecutable(join(dir, 'fake-healthcheck.sh'), '#!/usr/bin/env bash\nexit 0\n');
  writeExecutable(join(dir, 'fake-backup.sh'), '#!/usr/bin/env bash\necho backup-ok\nexit 0\n');
  return {
    dir,
    hooks,
    composeHooks,
    unixDir: unixPath(dir),
    unixHooks: unixPath(hooks),
    unixComposeHooks: unixPath(composeHooks),
  };
}

function runHarness(script, extraEnv = {}) {
  assert.ok(bash, 'bash is required for deploy health tests');
  const { dir, hooks, composeHooks, unixDir, unixHooks, unixComposeHooks } = setupHarness();
  const result = spawnSync(bash, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DEPLOY_ROOT: unixDir,
      DEPLOY_HARNESS: '1',
      HEALTHCHECK_HOOKS: unixHooks,
      COMPOSE_HOOKS: unixComposeHooks,
      HEALTHCHECK_SH: unixPath(join(dir, 'fake-healthcheck.sh')),
      BACKUP_SH: unixPath(join(dir, 'fake-backup.sh')),
      HEALTH_ATTEMPTS: '4',
      HEALTH_DELAY_SECONDS: '0',
      RUNNING_IMAGE_API: '',
      RUNNING_IMAGE_WEB: '',
      DOCKER_TAG_STUB: 'ok',
      ...extraEnv,
      _HARNESS_DIR: unixDir,
      _HOOKS: unixHooks,
    },
  });
  return { result, dir, hooks, composeHooks, unixDir };
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
  'Rollback succeeds from recorded image IDs without pulling',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result, dir } = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      export ROLLBACK_IMAGE_CHECK=ok
      write_previous_images "${PRODUCTION_API_ID}" "${PRODUCTION_WEB_ID}"
      bash "$REPO/deploy/rollback.sh"
      grep -q -F -- '--pull never' "$_HARNESS_DIR/compose.log"
      grep -q -F ':local-rollback' "$_HARNESS_DIR/.env.production"
      if grep -E '^pull[[:space:]]' "$_HARNESS_DIR/compose.log"; then echo pulled-remote; exit 1; fi
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Rollback restored local API\/Web image identities/);
    assert.match(result.stdout, /Database schema was not reverted/);
    assert.match(result.stdout, new RegExp(PRODUCTION_API_ID));
    assert.match(result.stdout, new RegExp(PRODUCTION_WEB_ID));
    const composeLog = readFileSync(join(dir, 'compose.log'), 'utf8');
    assert.match(composeLog, /--pull never/);
    assert.doesNotMatch(composeLog, /(^| )pull /);
  },
);

test(
  'Failed rollback and missing recorded images stay visible as failures',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const missing = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      if bash "$REPO/deploy/rollback.sh"; then echo unexpected-pass; exit 1; fi
    `);
    assert.equal(missing.result.status, 0, `${missing.result.stdout}\n${missing.result.stderr}`);
    assert.match(`${missing.result.stdout}\n${missing.result.stderr}`, /No recorded API\/Web image IDs/);

    const unavailable = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      export ROLLBACK_IMAGE_CHECK=missing
      write_previous_images "${PRODUCTION_API_ID}" "${PRODUCTION_WEB_ID}"
      if bash "$REPO/deploy/rollback.sh"; then echo unexpected-pass; exit 1; fi
      if grep -q pull compose.log 2>/dev/null; then echo pulled-remote; exit 1; fi
    `);
    assert.equal(unavailable.result.status, 0, `${unavailable.result.stdout}\n${unavailable.result.stderr}`);
    assert.match(`${unavailable.result.stdout}\n${unavailable.result.stderr}`, /not present locally/);
    assert.match(`${unavailable.result.stdout}\n${unavailable.result.stderr}`, /Do not docker pull/);

    const mutableTag = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      if bash "$REPO/deploy/rollback.sh" sha-f27c257; then echo unexpected-pass; exit 1; fi
    `);
    assert.equal(mutableTag.result.status, 0, `${mutableTag.result.stdout}\n${mutableTag.result.stderr}`);
    assert.match(`${mutableTag.result.stdout}\n${mutableTag.result.stderr}`, /Refusing rollback by mutable git commit tag/);
  },
);

test(
  'Image-tag mismatch records running digests instead of the mutable SHA tag',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result, dir } = runHarness(`
      source deploy/lib.sh
      export RUNNING_IMAGE_API=ghcr.io/bkbimal250/internal_chat_app/api:sha-f27c257
      export RUNNING_IMAGE_WEB=ghcr.io/bkbimal250/internal_chat_app/web:sha-f27c257
      export RUNNING_IMAGE_ID_API=${PRODUCTION_API_ID}
      export RUNNING_IMAGE_ID_WEB=${PRODUCTION_WEB_ID}
      atomic_write "$DEPLOYED_SHA_FILE" sha-f27c257
      record_previous_images
      record_previous_tag sha-f27c257 || true
      grep -q "api=${PRODUCTION_API_ID}" "$PREVIOUS_IMAGES_FILE"
      grep -q "web=${PRODUCTION_WEB_ID}" "$PREVIOUS_IMAGES_FILE"
      if grep -q sha-f27c257 "$PREVIOUS_IMAGES_FILE"; then echo tagged-in-id-file; exit 1; fi
      echo mismatch-ok
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /mismatch-ok/);
    const recorded = readFileSync(join(dir, '.previous-images'), 'utf8');
    assert.match(recorded, new RegExp(`api=${PRODUCTION_API_ID}`));
    assert.match(recorded, new RegExp(`web=${PRODUCTION_WEB_ID}`));
    assert.doesNotMatch(recorded, /sha-f27c257/);
    assert.doesNotMatch(recorded, new RegExp(REPUBLISHED_API_ID));
  },
);

test(
  'Missing rollback images fail safely and never pull',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result, dir } = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      export ROLLBACK_IMAGE_CHECK=missing
      write_previous_images "${PRODUCTION_API_ID}" "${PRODUCTION_WEB_ID}"
      if bash "$REPO/deploy/rollback.sh" --from-failure; then echo unexpected-pass; exit 1; fi
      test ! -f compose.log -o ! -s compose.log || ! grep -q pull compose.log
      echo missing-ok
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /missing-ok/);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /not present locally/);
    assert.match(output, /--local-tag rollback-pre-s3-20261109/);
    assert.doesNotMatch(output, /not local; pulling/);
    if (existsSync(join(dir, 'compose.log'))) {
      assert.doesNotMatch(readFileSync(join(dir, 'compose.log'), 'utf8'), /pull/);
    }
  },
);

test(
  'Partial deployment failure rolls back recorded IDs without a remote pull',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result, dir } = runHarness(`
      REPO="$PWD"
      cat > "$_HARNESS_DIR/fail-then-pass-health.sh" <<'HOOK'
#!/usr/bin/env bash
nfile="$_HARNESS_DIR/health-n"
n=$(( $(cat "$nfile" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$nfile"
if [ "$n" -eq 1 ]; then exit 1; fi
exit 0
HOOK
      chmod +x "$_HARNESS_DIR/fail-then-pass-health.sh"
      export HEALTHCHECK_SH="$_HARNESS_DIR/fail-then-pass-health.sh"
      export RUNNING_IMAGE_API=ghcr.io/bkbimal250/internal_chat_app/api:sha-f27c257
      export RUNNING_IMAGE_WEB=ghcr.io/bkbimal250/internal_chat_app/web:sha-f27c257
      export RUNNING_IMAGE_ID_API=${PRODUCTION_API_ID}
      export RUNNING_IMAGE_ID_WEB=${PRODUCTION_WEB_ID}
      export ROLLBACK_IMAGE_CHECK=ok
      if bash "$REPO/deploy/deploy.sh" sha-38d12bc --skip-migrate; then
        echo unexpected-deploy-pass
        exit 1
      fi
      grep -q "api=${PRODUCTION_API_ID}" "$_HARNESS_DIR/.previous-images"
      grep -q -- '--pull never' "$_HARNESS_DIR/compose.log"
      grep -q ':local-rollback' "$_HARNESS_DIR/.env.production"
      if ! grep -E '^pull[[:space:]]' "$_HARNESS_DIR/compose.log"; then echo missing-forward-pull; exit 1; fi
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /Deployment health checks failed/);
    assert.match(output, /Attempting rollback to recorded image IDs/);
    assert.match(output, /Rollback restored recorded image IDs/);
    assert.match(output, /Database schema was not reverted/);
    const composeLog = readFileSync(join(dir, 'compose.log'), 'utf8');
    assert.match(composeLog, /^pull api web$/m);
    assert.match(composeLog, /up -d --no-deps --no-build --pull never api web/);
    const envFile = readFileSync(join(dir, '.env.production'), 'utf8');
    assert.match(envFile, /API_IMAGE=.*:local-rollback/);
    assert.match(envFile, /WEB_IMAGE=.*:local-rollback/);
    assert.doesNotMatch(envFile, new RegExp(REPUBLISHED_API_ID));
  },
);

test(
  'Manual rollback uses a verified local pin without pulling',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result, dir } = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      export LOCAL_TAG_API_ID=${PRODUCTION_API_ID}
      export LOCAL_TAG_WEB_ID=${PRODUCTION_WEB_ID}
      bash "$REPO/deploy/rollback.sh" --local-tag rollback-pre-s3-20261109
      grep -q -F rollback-pre-s3-20261109 "$_HARNESS_DIR/.env.production"
      grep -q -F -- '--pull never' "$_HARNESS_DIR/compose.log"
      if grep -E '^pull[[:space:]]' "$_HARNESS_DIR/compose.log"; then echo pulled-remote; exit 1; fi
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Rollback restored local API\/Web image identities/);
    const composeLog = readFileSync(join(dir, 'compose.log'), 'utf8');
    assert.match(composeLog, /--pull never/);
    assert.doesNotMatch(composeLog, /(^| )pull /);
    const envFile = readFileSync(join(dir, '.env.production'), 'utf8');
    assert.match(envFile, /API_IMAGE=.*:rollback-pre-s3-20261109/);
    assert.match(envFile, /WEB_IMAGE=.*:rollback-pre-s3-20261109/);
  },
);

test(
  'CD retry of the same git SHA still records running image IDs and keeps .previous-sha',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result, dir } = runHarness(`
      source deploy/lib.sh
      export RUNNING_IMAGE_API=ghcr.io/bkbimal250/internal_chat_app/api:sha-f27c257
      export RUNNING_IMAGE_WEB=ghcr.io/bkbimal250/internal_chat_app/web:sha-f27c257
      export RUNNING_IMAGE_ID_API=${PRODUCTION_API_ID}
      export RUNNING_IMAGE_ID_WEB=${PRODUCTION_WEB_ID}
      atomic_write "$DEPLOYED_SHA_FILE" sha-f27c257
      atomic_write "$PREVIOUS_SHA_FILE" sha-aaaaaaa
      write_previous_images sha256:1111111111111111111111111111111111111111111111111111111111111111 sha256:2222222222222222222222222222222222222222222222222222222222222222
      record_previous_images
      record_previous_tag sha-f27c257
      test "$(cat "$PREVIOUS_SHA_FILE")" = "sha-aaaaaaa"
      test "$(cat "$DEPLOYED_SHA_FILE")" = "sha-f27c257"
      grep -q "api=${PRODUCTION_API_ID}" "$PREVIOUS_IMAGES_FILE"
      echo retry-ok
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /retry-ok/);
    assert.equal(readFileSync(join(dir, '.previous-sha'), 'utf8').trim(), 'sha-aaaaaaa');
    assert.equal(readFileSync(join(dir, '.deployed-sha'), 'utf8').trim(), 'sha-f27c257');
    const recorded = readFileSync(join(dir, '.previous-images'), 'utf8');
    assert.match(recorded, new RegExp(`api=${PRODUCTION_API_ID}`));
    assert.doesNotMatch(recorded, /1111111111111111/);
  },
);

test(
  'Legacy .previous-sha without image IDs refuses to pull the mutable tag',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const { result } = runHarness(`
      REPO="$PWD"
      source "$REPO/deploy/lib.sh"
      atomic_write "$PREVIOUS_SHA_FILE" sha-f27c257
      if bash "$REPO/deploy/rollback.sh"; then echo unexpected-pass; exit 1; fi
    `);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /legacy tag file/);
    assert.match(output, /Do not docker pull/);
    assert.match(output, /sha-f27c257/);
    assert.doesNotMatch(output, /not local; pulling/);
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
