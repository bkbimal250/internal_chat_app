import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relative) {
  return readFileSync(join(root, relative), 'utf8');
}

test('CD deploys on main only when DEPLOY_ENABLED is true', () => {
  const workflow = read('.github/workflows/cd.yml');
  assert.match(workflow, /vars\.DEPLOY_ENABLED == 'true'/);
  assert.doesNotMatch(
    workflow,
    /github\.event_name == 'workflow_dispatch' && vars\.DEPLOY_ENABLED/,
  );
  assert.match(workflow, /VPS_USER/);
  assert.match(workflow, /id -un/);
  assert.match(workflow, /deploy\.sh \$\{IMAGE_TAG\}/);
  assert.doesNotMatch(workflow, /sudo .*deploy\.sh/);
});

test('deploy scripts refuse root, volume destruction, and unapproved workers', () => {
  const deploy = read('deploy/deploy.sh');
  const lib = read('deploy/lib.sh');
  const health = read('deploy/healthcheck.sh');
  assert.match(deploy, /id -u/);
  assert.match(deploy, /Refusing to deploy as root/);
  assert.doesNotMatch(deploy, /compose down/);
  assert.doesNotMatch(deploy, /volume prune/);
  assert.match(lib, /RETENTION_WORKER_ENABLED/);
  assert.match(health, /RETENTION_WORKER_ENABLED/);
  assert.match(deploy, /docker login ghcr.io/);
});
