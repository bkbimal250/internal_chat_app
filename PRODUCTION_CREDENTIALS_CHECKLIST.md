# Production credentials checklist

Never commit, paste, or log real secret values. Use placeholders here.

How to verify a secret without printing it:

- File present: `test -f /opt/company-chat/.env.production && echo present`
- Non-empty: `grep -c '^JWT_SECRET=.\+' /opt/company-chat/.env.production`
- Container sees it: `docker compose exec api node -e "process.exit(process.env.JWT_SECRET && process.env.JWT_SECRET.length>=64?0:1)"`

Restart: change a variable, then recreate **only** the service that reads it (`api`, `retention-worker`, `web`, `caddy`, or `postgres`). Do not recreate Postgres unless the database password itself changed.

## Where each class of secret lives

| Location | What belongs there | What must not |
| --- | --- | --- |
| **VPS** `/opt/company-chat/.env.production` (mode 600) | Postgres, JWT, SMS, S3, CORS, domain, GHCR pull token | GitHub SSH key |
| **VPS** `/opt/company-chat/secrets/firebase-service-account.json` (mode 600) | Firebase Admin JSON | — |
| **GitHub Environment `production` secrets** | `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT`, `VPS_DEPLOY_DIR`, `VPS_SSH_KNOWN_HOSTS` | JWT, DB, SMS, S3, Firebase |
| **GitHub repository variables** | `DEPLOY_ENABLED` (keep unset until you authorize deploy), optional `IOS_BUILD_ENABLED` | Any password |
| **GitHub Actions `GITHUB_TOKEN`** | GHCR push from `main` | VPS app secrets |
| **This git repo** | Examples and Compose files only | `.env`, Firebase JSON, `google-services.json`, iOS plist |

`GITHUB_TOKEN` already can push GHCR packages when Actions has read/write permission. A **separate** PAT with `read:packages` is required **on the VPS** as `GHCR_TOKEN`.

---

## Database (containers: `postgres`, `api`, `retention-worker`, `migrate`)

| Variable | Purpose | Required | Placeholder | Where | Restart | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| `POSTGRES_USER` | Database role | Required | `company_chat` | VPS env | postgres + api | `compose exec postgres psql -U "$POSTGRES_USER" -c '\conninfo'` |
| `POSTGRES_PASSWORD` | Database password | Required | `replace-with-a-long-random-password` | VPS env | postgres + api | length check only |
| `POSTGRES_DB` | Database name | Required | `company_chat` | VPS env | postgres + api | `pg_isready` |
| `DATABASE_URL` | Optional override | Optional | built from the three values above | VPS env | api + worker + migrate | api `/health/ready` |
| Postgres host | Docker DNS `postgres` | Built-in | `postgres` | Compose | — | ready check |
| Postgres port | Internal `5432` only | Built-in | unpublished | Compose | — | no public port in `compose ps` |

You supply the password. Do not publish 5432.

---

## Object storage (containers: `api`, `retention-worker`; optional `storage`)

| Variable | Purpose | Required | Placeholder | Where | Restart | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| `STORAGE_IN_CLUSTER` | `1` = LocalStack overlay; `0` = AWS/R2/MinIO | Required | `0` recommended; `1` only to keep existing LocalStack volume | VPS env | compose project | `compose ps` shows `storage` only when `1` |
| `S3_ENDPOINT` | SDK endpoint | Required in production | `https://<accountid>.r2.cloudflarestorage.com` or `http://storage:4566` | VPS env | api + worker | `/health/ready` `storage=connected` |
| `S3_PUBLIC_ENDPOINT` | Presigned URL host browsers/mobile hit | Required | `https://media.example.com` or `https://chat.example.com/s3` | VPS env | api | signed URL host matches |
| `S3_REGION` | Provider region | Required | `us-east-1` | VPS env | api | HeadBucket |
| `S3_BUCKET` | Private bucket | Required | `company-chat` | VPS env | api | HeadBucket |
| `S3_ACCESS_KEY` | Access key | Required | `replace-with-s3-access-key` | VPS env | api + worker | ready check |
| `S3_SECRET_KEY` | Secret key | Required | `replace-with-a-long-random-s3-secret` | VPS env | api + worker | ready check |
| `S3_FORCE_PATH_STYLE` | Path-style addressing | Required | `true` for LocalStack/MinIO/R2; `false` for AWS virtual-host | VPS env | api | upload init |
| `S3_CREATE_BUCKET` | Allow API to create the bucket | Optional | `0` in cloud; `1` for LocalStack | VPS env | api | missing-bucket log absent |
| `S3_PROXY_UPSTREAM` | Caddy `/s3` backend | Optional | `storage:4566` | VPS env | caddy | unused when using provider URLs |
| `S3_UPLOAD_TTL_SECONDS` | Presign PUT expiry | Optional | `900` | VPS env | api | — |
| `S3_DOWNLOAD_TTL_SECONDS` | Presign GET expiry | Optional | `60` | VPS env | api | — |
| `ATTACHMENT_PENDING_TTL_MS` | Abandoned upload expiry | Optional | `7200000` | VPS env | api | — |
| `ATTACHMENT_DAILY_QUOTA_BYTES` | Daily quota | Optional | `8589934592` | VPS env | api | — |
| `ATTACHMENT_RATE_LIMIT` | Upload API rate | Optional | `60` | VPS env | api | — |

You must create the cloud bucket, block public listing, enable CORS for the HTTPS site when browsers PUT directly to the provider, and keep objects private. LocalStack is not the recommended production store.

---

## Authentication (containers: `api`)

| Variable | Purpose | Required | Placeholder | Where | Restart | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| `JWT_SECRET` | Access JWT + CSRF HMAC | Required, ≥64 chars | `replace-with-at-least-64-cryptographically-random-characters` | VPS env | api | length check; login |
| `JWT_ISSUER` | JWT issuer | Required | `company-chat-api` | VPS env | api | login |
| `JWT_AUDIENCE` | JWT audience | Required | `company-chat-clients` | VPS env | api | login |
| `REFRESH_TOKEN_DAYS` | Refresh cookie / session lifetime | Optional | `30` | VPS env | api | cookie max-age |
| `AUTH_RATE_LIMIT` | Login rate | Optional | `10` | VPS env | api | 429 |
| Cookie flags | `Secure` + `HttpOnly` + `SameSite=Strict` when `NODE_ENV=production` | Built-in | — | code | — | HTTPS login |
| `CORS_ORIGINS` | Exact HTTPS origins; empty disables CORS (same-origin SPA) | Required for external S3 browser PUT | `https://chat.example.com` | VPS env | api | preflight |
| CSRF | `chat_csrf` cookie + `x-csrf-token` | Built-in | — | code | — | refresh |

There is no separate refresh-token secret; refresh uses the HTTP-only cookie and `JWT_SECRET` for CSRF.

---

## SMS / OTP (containers: `api`)

| Variable | Purpose | Required | Placeholder | Where | Restart | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| `SMS_API_URL` | Hilite HTTP API | Required | default Hilite URL | VPS env | api | OTP send |
| `SMS_USERNAME` | Hilite user | **Required in production** | `replace-with-sms-username` | VPS env | api | process starts |
| `SMS_API_KEY` | Hilite key | **Required in production** | `replace-with-sms-api-key` | VPS env | api | OTP arrives |
| `SMS_TEMPLATE_ID` | DLT template | **Required in production** | `replace-with-dlt-template-id` | VPS env | api | DLT accept |
| `SMS_SENDER` | Sender id | Required | `SPAADV` | VPS env | api | — |
| `SMS_ROUTE` | Hilite route | Required | `ServiceImplicit` | VPS env | api | — |
| `OTP_TTL_SECONDS` | Code lifetime | Optional | `60` | VPS env | api | — |

You supply Hilite credentials. Production will not boot without them.

---

## Firebase / mobile push (containers: `api`, `retention-worker`; Flutter apps)

| Item | Purpose | Required | Placeholder | Where | Restart | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Path **inside** the container | Optional | `/app/secrets/firebase-service-account.json` | VPS env | api + worker | logs `PUSH_UNCONFIGURED` vs send |
| `FIREBASE_SECRET_PATH` | Host path mounted read-only | Optional | `/opt/company-chat/secrets/firebase-service-account.json` | VPS env | api + worker | `test -f` |
| Firebase project ID | Inside the JSON | Required for push | from Firebase Console | VPS file | api | JSON `project_id` exists (do not cat the file) |
| Android application id | `com.companychat.company_chat` | Required for FCM | keep in sync with Firebase Android app | Firebase Console | mobile release | Firebase app list |
| iOS bundle id | `com.companychat.companyChat` | Required for APNs | keep in sync with Firebase iOS app | Firebase Console + Apple | mobile release | APNs key uploaded |
| `google-services.json` / `GoogleService-Info.plist` | Client Firebase config | Required for store builds | local untracked files | developer machine / CI secrets, **not** the VPS | mobile build | app registers a token |

Push stays disabled until the JSON contains `private_key` and `client_email`. Do not commit those files.

---

## Deployment / GitHub / VPS

| Item | Purpose | Required | Placeholder | Where | Restart | Verify |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub owner/repo | GHCR path | Required | `bkbimal250/internal_chat_app` | GitHub | — | `gh repo view` |
| GHCR images | `ghcr.io/bkbimal250/internal_chat_app/api` and `/web` | Required | `sha-<git-sha>` | GHCR | VPS pull | `docker pull` on VPS |
| `API_IMAGE` / `WEB_IMAGE` / `IMAGE_TAG` | Exact release | Required | written by `deploy.sh` | VPS env | api/web/worker | `compose ps` |
| `GHCR_USERNAME` / `GHCR_TOKEN` | VPS pull of private packages | Required | PAT `read:packages` | **VPS only** | — | `docker login ghcr.io` |
| `VPS_HOST` | SSH target | Required for CD | IPv4 or hostname | GitHub env secret | — | `ssh` from Actions after approval |
| `VPS_USER` | Non-root deploy user | Required for CD | `deploy` | GitHub env secret | — | member of `docker` group |
| `VPS_SSH_KEY` | Private key | Required for CD | ed25519 key | GitHub env secret | — | public key in `authorized_keys` |
| `VPS_PORT` | SSH port | Optional | `22` | GitHub env secret | — | — |
| `VPS_DEPLOY_DIR` | App directory | Optional | `/opt/company-chat` | GitHub env secret | — | — |
| `VPS_SSH_KNOWN_HOSTS` | Pinned host keys | **Required** for CD | `ssh-keyscan` output captured **once** by you | GitHub env secret | — | — |
| `CHAT_SITE` | Public hostname | Required for TLS | `chat.example.com` | VPS env | caddy | HTTPS 200 |
| `CADDY_EMAIL` | Let's Encrypt contact | Required for TLS | `admin@example.com` | VPS env | caddy | cert in `caddy_data` |
| `DEPLOY_ENABLED` | Gates the CD deploy job | Keep unset / false until you authorize | `true` only after review | GitHub **variable** | — | CD deploy job skipped |
| `TRUST_PROXY` | Honor `X-Forwarded-*` | Required behind Caddy | `1` | Compose (forced on api) | api | rate-limit client IP |
| `NODE_ENV` | Production checks | Required | `production` | Compose (forced on api) | api | Secure cookies |

You supply: domain, VPS SSH details, GHCR pull token, SMS, JWT, Postgres password, S3, Firebase. GitHub only stores VPS SSH material.

---

## Values you must provide manually before any live deploy

1. Production hostname and DNS A/AAAA record
2. Let's Encrypt contact email
3. Unique `JWT_SECRET` (≥64 chars) and `POSTGRES_PASSWORD`
4. Hilite `SMS_USERNAME`, `SMS_API_KEY`, `SMS_TEMPLATE_ID`
5. S3-compatible endpoint, region, bucket, keys, and whether `STORAGE_IN_CLUSTER` is `0` or `1`
6. Firebase Admin JSON on the VPS (optional only if you accept no mobile push)
7. GitHub `production` environment + SSH secrets listed above
8. VPS `GHCR_TOKEN` with `read:packages`
9. Flutter production `--dart-define` URLs when you cut a store build

Until those exist, keep `DEPLOY_ENABLED` unset.
