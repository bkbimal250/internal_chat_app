import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env.js';
import { runRetentionWorker } from '../workers/retention.worker.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relative) {
  return readFileSync(join(root, relative), 'utf8');
}

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

function runBash(script, extraEnv = {}) {
  assert.ok(bash, 'bash is required for deploy guard execution tests');
  return spawnSync(bash, ['-c', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

test('CD refuses unauthorized refs even when DEPLOY_ENABLED is true', () => {
  const workflow = read('.github/workflows/cd.yml');
  assert.match(workflow, /name: Require main branch/);
  assert.match(workflow, /Production CD is limited to the main branch/);
  assert.match(workflow, /Production CD cannot run from a pull request/);
  const mainGuards = workflow.match(/github\.ref == 'refs\/heads\/main'/g) ?? [];
  assert.ok(mainGuards.length >= 4, 'ci, publish, deploy-gate, and deploy must require main');
  assert.match(
    workflow,
    /github\.ref == 'refs\/heads\/main' && needs\.deploy-gate\.outputs\.enabled == 'true' && vars\.DEPLOY_ENABLED == 'true'/,
  );
  assert.doesNotMatch(workflow, /DEPLOY_ENABLED:\s*['"]?true['"]?/);
  assert.doesNotMatch(
    workflow,
    /github\.event_name == 'workflow_dispatch' && vars\.DEPLOY_ENABLED/,
  );
  assert.match(workflow, /secrets\.VPS_USER \}\}" != "deploy"/);
  assert.match(workflow, /REMOTE_USER" != "deploy"/);
  assert.match(workflow, /deploy\.sh \$\{IMAGE_TAG\}/);
  assert.doesNotMatch(workflow, /sudo .*deploy\.sh/);
});

test('deploy.sh validates VPS safety after load_env and backups before migrate', () => {
  const deploy = read('deploy/deploy.sh');
  const lib = read('deploy/lib.sh');
  const backup = read('deploy/backup.sh');
  const compose = read('docker-compose.prod.vps.yml');
  const health = read('deploy/healthcheck.sh');
  const vpsEnv = read('deploy/.env.vps.example');

  assert.match(deploy, /load_env\r?\nrequire_deploy_safety/);
  assert.match(deploy, /Backing up PostgreSQL before changing application images/);
  assert.match(deploy, /deploy\/backup\.sh[\s\S]*Applying forward-only migrations/);
  assert.match(deploy, /require_deploy_user/);
  assert.match(lib, /id -un/);
  assert.match(lib, /Expected \$\{expected\}/);
  assert.match(deploy, /docker login ghcr\.io/);
  assert.doesNotMatch(deploy, /compose down/);
  assert.doesNotMatch(deploy, /volume prune/);
  assert.doesNotMatch(deploy, /docker (compose )?build/);

  assert.match(lib, /DEPLOY_TARGET must be vps/);
  assert.match(lib, /COMPOSE_FILE must be docker-compose\.prod\.vps\.yml/);
  assert.match(lib, /COMPOSE_PROJECT_NAME must stay internal-chat/);
  assert.match(lib, /after load_env/);
  assert.match(lib, /Refusing Compose command/);
  assert.match(lib, /down\|build\|prune\|kill/);
  assert.match(lib, /--build\|--volumes\|-v/);
  assert.match(lib, /Host or foreign service|Refusing to recreate host/);
  assert.match(lib, /RETENTION_WORKER_ENABLED/);

  assert.match(backup, /empty dump; refusing to continue/);
  assert.match(backup, /require_company_chat_database/);
  assert.match(lib, /POSTGRES_DB must be company_chat/);
  assert.match(compose, /profiles: \[retention\]/);
  assert.doesNotMatch(compose, /^\s+postgres:/m);
  assert.doesNotMatch(compose, /^\s+nginx:/m);
  assert.doesNotMatch(compose, /^\s+caddy:/m);
  assert.match(health, /RETENTION_WORKER_ENABLED is off/);
  assert.match(vpsEnv, /RETENTION_WORKER_ENABLED=0/);
  assert.match(vpsEnv, /DEPLOY_TARGET=vps/);
  assert.match(vpsEnv, /COMPOSE_FILE=docker-compose\.prod\.vps\.yml/);
  assert.match(vpsEnv, /COMPOSE_PROJECT_NAME=internal-chat/);
});

test('RETENTION_WORKER_ENABLED defaults off and skips the worker process', async () => {
  const config = loadEnv({
    JWT_SECRET: 'deploy-safety-test-only-secret-'.repeat(3),
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  assert.equal(config.retentionWorkerEnabled, false);
  const skipped = await runRetentionWorker({ config, once: true });
  assert.equal(skipped.skipped, 'disabled');

  const enabled = loadEnv({
    JWT_SECRET: 'deploy-safety-test-only-secret-'.repeat(3),
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    RETENTION_WORKER_ENABLED: '1',
  });
  assert.equal(enabled.retentionWorkerEnabled, true);
});

test(
  'bash deploy guards reject unsafe Compose and env overrides',
  { skip: !bash && 'bash is not available on this host' },
  () => {
    const syntax = ['deploy/lib.sh', 'deploy/deploy.sh', 'deploy/backup.sh', 'deploy/healthcheck.sh', 'deploy/rollback.sh'];
    for (const file of syntax) {
      const checked = spawnSync(bash, ['-n', file], { cwd: root, encoding: 'utf8' });
      assert.equal(checked.status, 0, checked.stderr || file);
    }

    const safe = runBash(`
      set -euo pipefail
      source deploy/lib.sh
      COMPOSE_PROJECT_NAME=internal-chat
      DEPLOY_TARGET=vps
      COMPOSE_FILE=docker-compose.prod.vps.yml
      RETENTION_WORKER_ENABLED=0
      require_deploy_safety
      services="$(app_services | tr '\\n' ' ')"
      test "$services" = "api web "
    `);
    assert.equal(safe.status, 0, `${safe.stdout}\n${safe.stderr}`);

    const wrongProject = runBash(`
      source deploy/lib.sh
      COMPOSE_PROJECT_NAME=other-app
      DEPLOY_TARGET=vps
      COMPOSE_FILE=docker-compose.prod.vps.yml
      require_deploy_safety
    `);
    assert.notEqual(wrongProject.status, 0);
    assert.match(`${wrongProject.stdout}\n${wrongProject.stderr}`, /internal-chat/);

    const wrongTarget = runBash(`
      source deploy/lib.sh
      COMPOSE_PROJECT_NAME=internal-chat
      DEPLOY_TARGET=other
      COMPOSE_FILE=docker-compose.prod.vps.yml
      require_deploy_safety
    `);
    assert.notEqual(wrongTarget.status, 0);
    assert.match(`${wrongTarget.stdout}\n${wrongTarget.stderr}`, /DEPLOY_TARGET/);

    const wrongCompose = runBash(`
      source deploy/lib.sh
      COMPOSE_PROJECT_NAME=internal-chat
      DEPLOY_TARGET=vps
      COMPOSE_FILE=docker-compose.prod.yml
      require_deploy_safety
    `);
    assert.notEqual(wrongCompose.status, 0);
    assert.match(`${wrongCompose.stdout}\n${wrongCompose.stderr}`, /docker-compose\.prod\.vps\.yml/);

    const down = runBash(`
      source deploy/lib.sh
      if (refuse_destructive down); then echo 'down was allowed'; exit 1; fi
      if (refuse_destructive build); then echo 'build was allowed'; exit 1; fi
      if (refuse_destructive --build); then echo '--build was allowed'; exit 1; fi
      if (refuse_destructive up --volumes); then echo 'volumes was allowed'; exit 1; fi
      if (refuse_destructive volume prune); then echo 'prune was allowed'; exit 1; fi
    `);
    assert.equal(down.status, 0, `${down.stdout}\n${down.stderr}`);
  },
);
