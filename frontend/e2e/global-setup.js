import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const authDir = path.join(here, '.auth')

export default async function globalSetup() {
  const live = await fetch('http://127.0.0.1:3001/health/live')
  const ready = await fetch('http://127.0.0.1:3001/health/ready')
  if (!live.ok || !ready.ok) {
    throw new Error('API is not healthy. Start Docker Compose before frontend E2E tests.')
  }

  const runId = randomBytes(3).toString('hex')
  const password = `E2e-${runId}-Verify9x`
  const changedPassword = `E2e-${runId}-Changed9x`
  const accounts = {
    runId,
    password,
    changedPassword,
    alpha: {
      key: 'alpha',
      username: `e2e.${runId}.alpha`,
      displayName: `E2E Alpha ${runId}`,
      role: 'user',
      mustChangePassword: false,
      password,
    },
    bravo: {
      key: 'bravo',
      username: `e2e.${runId}.bravo`,
      displayName: `E2E Bravo ${runId}`,
      role: 'user',
      mustChangePassword: false,
      password,
    },
    charlie: {
      key: 'charlie',
      username: `e2e.${runId}.charlie`,
      displayName: `E2E Charlie ${runId}`,
      role: 'user',
      mustChangePassword: false,
      password,
    },
    admin: {
      key: 'admin',
      username: `e2e.${runId}.admin`,
      displayName: `E2E Admin ${runId}`,
      role: 'admin',
      mustChangePassword: false,
      password,
    },
    first: {
      key: 'first',
      username: `e2e.${runId}.first`,
      displayName: `E2E First ${runId}`,
      role: 'user',
      mustChangePassword: true,
      password,
    },
  }

  const seedPayload = [
    accounts.alpha,
    accounts.bravo,
    accounts.charlie,
    accounts.admin,
    accounts.first,
  ]
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      '-e',
      `E2E_SEED_B64=${Buffer.from(JSON.stringify(seedPayload)).toString('base64')}`,
      'api',
      'node',
      '--input-type=module',
    ],
    {
      cwd: repoRoot,
      input: readFileSync(path.join(here, 'seed-inside-api.mjs')),
      encoding: 'utf8',
    },
  )

  if (result.status !== 0) {
    throw new Error(`Failed to seed isolated E2E accounts: ${result.stderr || result.stdout}`)
  }

  const match = String(result.stdout).match(/E2E_SEED_RESULT:(\{.*\})/)
  if (!match) {
    throw new Error(`Seed script did not return accounts. Output: ${result.stdout}`)
  }

  const seeded = JSON.parse(match[1])
  for (const [key, user] of Object.entries(seeded.users)) {
    accounts[key] = { ...accounts[key], ...user, password }
  }

  mkdirSync(authDir, { recursive: true })
  writeFileSync(path.join(authDir, 'accounts.json'), JSON.stringify(accounts, null, 2))
}
