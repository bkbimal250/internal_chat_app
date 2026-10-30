import pg from 'pg'
import { hashPassword } from '/app/src/services/password.service.js'
import { loadEnv } from '/app/src/config/env.js'

const seed = JSON.parse(Buffer.from(process.env.E2E_SEED_B64 || '', 'base64').toString('utf8'))
if (!Array.isArray(seed) || seed.length === 0) {
  throw new Error('E2E_SEED_B64 is missing or invalid')
}

const config = loadEnv()
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 2 })

async function upsert(account) {
  const passwordHash = await hashPassword(account.password)
  const existing = await pool.query('select id from users where lower(username) = lower($1)', [
    account.username,
  ])
  if (existing.rows[0]) {
    await pool.query(
      `update users
       set password_hash = $1,
           display_name = $2,
           role = $3::user_role,
           status = 'active'::user_status,
           must_change_password = $4,
           deleted_at = null,
           updated_at = now()
       where id = $5`,
      [
        passwordHash,
        account.displayName,
        account.role,
        account.mustChangePassword,
        existing.rows[0].id,
      ],
    )
    return existing.rows[0].id
  }
  const inserted = await pool.query(
    `insert into users (username, display_name, password_hash, role, status, must_change_password)
     values ($1, $2, $3, $4::user_role, 'active'::user_status, $5)
     returning id`,
    [account.username, account.displayName, passwordHash, account.role, account.mustChangePassword],
  )
  return inserted.rows[0].id
}

const users = {}
for (const account of seed) {
  users[account.key] = {
    key: account.key,
    id: await upsert(account),
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    mustChangePassword: account.mustChangePassword,
  }
}

process.stdout.write(`E2E_SEED_RESULT:${JSON.stringify({ users })}\n`)
await pool.end()
