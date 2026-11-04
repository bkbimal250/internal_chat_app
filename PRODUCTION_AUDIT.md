# Company Chat production audit

Date: 2026-11-03  
Scope: source, Docker, GitHub Actions, and local validation only.  
**No VPS was contacted and no live deployment was attempted.**

Status key:

- **READY** — implemented in this repository and locally checked where feasible
- **NEEDS CONFIGURATION** — code is ready; you must supply a value
- **BLOCKED** — cannot go live until you provide it or explicitly decide
- **UNVERIFIED** — implemented or documented, not proven against production

## Executive summary

GitHub can build and test images. The VPS Compose file uses `image:` only. Application credentials stay on the VPS. A push to `main` publishes images and deploys only when `DEPLOY_ENABLED=true`. Leave that variable unset until the `deploy` user GHCR login is verified.

Do not start a live deploy until the blockers below are resolved and you explicitly authorize it.

## Component status

| Area | Status | Notes |
| --- | --- | --- |
| Fastify API multi-stage image, non-root `node`, health/live + health/ready, SIGTERM shutdown | READY | `backend/Dockerfile`, `backend/src/server.js` |
| React production Nginx image, SPA fallback, gzip, cache headers | READY | `frontend/Dockerfile`, `frontend/nginx.conf`; Vite is not used in production |
| Same-origin `/api` and `wss` when `VITE_API_BASE_URL` is empty | READY | `frontend/src/config/env.js` |
| Production Compose without application `build:` keys | READY | `docker-compose.prod.yml` |
| Caddy HTTPS/WSS, 2 GB body, 3600s timeouts, security headers | READY | `deploy/Caddyfile` — live TLS is UNVERIFIED |
| PostgreSQL 17 named volume `internal-chat_postgres_data`, unpublished port | READY | Same project name as local Compose |
| Forward-only Drizzle migrations, one-shot `migrate` profile | READY | `backend/src/database/migrate.js`; 0000–0010 present |
| Retention worker, same API image, preview until admin approval | READY | Destructive cleanup stays off |
| S3 multipart (8 MB parts, 2 GiB cap), SHA-256 of completed object | READY | Multipart ETag is not treated as MD5 |
| Optional in-cluster LocalStack overlay | READY | `docker-compose.prod.local-s3.yml` when `STORAGE_IN_CLUSTER=1` |
| External AWS S3 / Cloudflare R2 / MinIO | NEEDS CONFIGURATION | Endpoint, keys, bucket, CORS origin |
| GitHub Actions CI (lint, tests, frontend build, image build, Compose config) | READY | `.github/workflows/ci.yml` |
| GHCR publish on `main` with `sha-<git-sha>` tags | READY / UNVERIFIED | Workflow exists; no image has been pushed from this machine |
| VPS pull-only deploy | BLOCKED | `DEPLOY_ENABLED` must stay unset until you approve |
| SMS (Hilite DLT) | BLOCKED | Production process exits without `SMS_USERNAME`, `SMS_API_KEY`, `SMS_TEMPLATE_ID` |
| JWT signing secret | NEEDS CONFIGURATION | `JWT_SECRET` ≥ 64 random characters, unique to production |
| Database password | NEEDS CONFIGURATION | `POSTGRES_PASSWORD` on the VPS only |
| Firebase Admin + Android/iOS apps | NEEDS CONFIGURATION | Push disables itself without a real service-account JSON |
| Production domain + Let's Encrypt | BLOCKED | `CHAT_SITE` and `CADDY_EMAIL` |
| GitHub `production` environment + VPS SSH secrets | BLOCKED | See credentials checklist |
| GHCR pull token on the VPS | BLOCKED | Packages are private by default |
| Flutter production HTTPS/WSS `--dart-define` | NEEDS CONFIGURATION | Defaults remain emulator loopback |
| 90-day retention destructive cleanup | READY (off) | Do not activate during deploy |
| 50 concurrent sessions per account | READY | Unchanged |
| Local 2 GB upload through production Caddy | UNVERIFIED | Not executed |
| Live WSS reconnect across API replace | UNVERIFIED | Clients reconnect; this is not blue-green |
| Backup restore drill on production data | UNVERIFIED | `deploy/restore.sh` exists; not run against live data |

## Verified production issues fixed in this pass

1. Production Compose assumed LocalStack. External S3/R2/MinIO is now the documented production path; LocalStack is an explicit overlay so the existing `storage_data` volume is not required and is not deleted.
2. CD used mixed-case GHCR names and lacked `actions: write` for Buildx cache.
3. Deploy used `ssh-keyscan` when known_hosts was missing (TOFU/MITM risk). Known_hosts is now required.
4. `ensureBucket()` created buckets and applied localhost CORS in production. Production no longer creates buckets unless `S3_CREATE_BUCKET=1`, and localhost CORS is not applied.
5. A missing Firebase JSON caused Compose to mount a directory. A placeholder file is mounted; push stays disabled until a real key is present.
6. Application deploy could leave an updated Caddyfile unloaded. `deploy.sh` now recreates `caddy` without touching Postgres.

## Architecture (intended production)

```
Internet
  → Caddy :80/:443 (TLS, WSS, 2 GB body)
      → web (Nginx static SPA :8080)
      → api (Fastify :3001, internal)
      → optional LocalStack :4566 only when STORAGE_IN_CLUSTER=1
  api / retention-worker / migrate
      → postgres (internal only)
      → S3-compatible store (Docker DNS or provider endpoint)
```

GitHub Actions never SSHes until `DEPLOY_ENABLED=true`. The VPS never runs `npm install` or `docker build`.

## Data safety

- Compose project name is `internal-chat` so existing named volumes stay attached.
- Deploy scripts refuse `docker compose down -v` and `--volumes`.
- Migrations are forward-only and run in a single one-shot container.
- Rollback restores previous application images only. Schema is not reverted.
- Retention worker records preview jobs until an admin enables cleanup.

## Flutter

The mobile app is **not** a VPS container. Android application id is `com.companychat.company_chat`. iOS bundle id is `com.companychat.companyChat`. Release builds must pass production `--dart-define=API_BASE_URL` and `WS_URL`. Store signing is BLOCKED until you supply keystore / Apple credentials.

## What this audit did not run

- GitHub Actions on `github.com`
- GHCR login/push
- SSH to a VPS
- Let's Encrypt issuance
- Live SMS
- Live FCM/APNs
- Live 100 MB–2 GB transfers through Caddy
- `TEST_DATABASE_URL` integration tests (require a dedicated `*_test` database)

Local checks that **were** run are listed in `deploy/VALIDATION.md`. Summary: Compose configs valid, backend 36 tests passed / 24 skipped, frontend 65 tests passed, both production images built, isolated web `/healthz` returned `ok`. GHCR, VPS, TLS, SMS, Firebase, and live 2 GB transfers were not executed.
