# Company Chat deployment guide

GitHub Actions builds and tests Docker images. GHCR stores immutable `sha-<commit>` tags. The VPS only pulls those images and runs Compose.

```
GitHub → Actions CI → GHCR (sha-<git-sha>) → VPS Docker Compose pull/up
```

**Do not deploy until `PRODUCTION_AUDIT.md` is reviewed and you explicitly set `DEPLOY_ENABLED=true`.**

This is not blue-green. Replacing the API container drops WebSocket clients for a few seconds; browsers and the mobile app reconnect and sync with `afterSeq` / `afterChangeSeq`.

## Safety rules

- Never run `docker compose down -v`, `docker volume prune`, or a database reset.
- Keep `COMPOSE_PROJECT_NAME=internal-chat` so `internal-chat_postgres_data` (and `internal-chat_storage_data` if used) stay attached.
- Never compile or `npm install` on the VPS.
- Never bake `.env` or Firebase JSON into image layers.
- Do not enable retention cleanup as part of deploy.
- Do not publish PostgreSQL or S3 ports.

## 1. GitHub repository

Repository: `https://github.com/bkbimal250/internal_chat_app`

Settings → Actions → General:

- Workflow permissions: Read and write (`GITHUB_TOKEN` must push GHCR)
- Allow GitHub Actions to create and approve pull requests: off

Protect `main`. Require the CI workflow.

Create GitHub Environment `production`. Require reviewers if more than one operator can deploy.

### GitHub variable (repository)

| Name | Value |
| --- | --- |
| `DEPLOY_ENABLED` | leave unset or `false` until you authorize the first live deploy |

### GitHub secrets (environment `production` only)

| Secret | Value |
| --- | --- |
| `VPS_HOST` | public IPv4 or hostname |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | private key for that user |
| `VPS_PORT` | `22` unless changed |
| `VPS_DEPLOY_DIR` | `/opt/company-chat` |
| `VPS_SSH_KNOWN_HOSTS` | output of `ssh-keyscan -p 22 <host>` captured by you on a trusted network |

Do not put JWT, Postgres, SMS, S3, or Firebase material in GitHub.

## 2. VPS bootstrap (once, by you)

Install current Docker Engine and the Compose v2 plugin. Create a non-root user:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/company-chat/secrets /opt/company-chat/backups /opt/company-chat/deploy
sudo chown -R deploy:deploy /opt/company-chat
sudo chmod 700 /opt/company-chat/secrets
```

Firewall: allow 22, 80, 443 only. Bind SSH to keys; disable password login.

Copy `docker-compose.prod.yml`, `docker-compose.prod.local-s3.yml`, and `deploy/` to `/opt/company-chat`. Copy `deploy/.env.production.example` to `/opt/company-chat/.env.production` and replace every placeholder.

Required production edits:

- `PROD_ENV_FILE=.env.production`
- `CHAT_SITE=chat.example.com` (hostname only)
- `CADDY_EMAIL`
- Unique `JWT_SECRET` and `POSTGRES_PASSWORD`
- SMS credentials
- S3 mode (see below)
- `FIREBASE_SECRET_PATH=./secrets/firebase-service-account.json` when you have a real key
- `GHCR_USERNAME` and `GHCR_TOKEN` (PAT `read:packages`)

```bash
chmod 600 /opt/company-chat/.env.production
chmod 600 /opt/company-chat/secrets/firebase-service-account.json   # if present
```

### Object storage mode

**External S3 / R2 / MinIO (recommended)**

```
STORAGE_IN_CLUSTER=0
S3_ENDPOINT=https://<provider-endpoint>
S3_PUBLIC_ENDPOINT=https://media.example.com
S3_FORCE_PATH_STYLE=true    # false for AWS virtual-hosted buckets
S3_CREATE_BUCKET=0
CORS_ORIGINS=https://chat.example.com
```

Create the bucket yourself. Keep it private. Configure provider CORS for `PUT`, `GET`, `HEAD` from the HTTPS site. Enable abort of incomplete multipart uploads after 2 days if the provider supports lifecycle rules.

**Existing LocalStack volume on this host**

```
STORAGE_IN_CLUSTER=1
S3_ENDPOINT=http://storage:4566
S3_PUBLIC_ENDPOINT=https://chat.example.com/s3
S3_FORCE_PATH_STYLE=true
S3_CREATE_BUCKET=1
```

This overlay reuses `internal-chat_storage_data`. Do not delete that volume.

### First start (after images exist in GHCR)

```bash
cd /opt/company-chat
# login to GHCR once
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres
# only if STORAGE_IN_CLUSTER=1:
# docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.prod.local-s3.yml up -d postgres storage

./deploy/backup.sh
docker compose --env-file .env.production -f docker-compose.prod.yml --profile migrate run --rm migrate
./deploy/deploy.sh sha-<git-sha>
./deploy/healthcheck.sh
```

Use `./deploy/deploy.sh` after the env file is real; it refuses the example file.

## 3. Daily releases

A merge to `main` runs CI, publishes:

- `ghcr.io/bkbimal250/internal_chat_app/api:sha-<full-git-sha>`
- `ghcr.io/bkbimal250/internal_chat_app/web:sha-<full-git-sha>`

A push to `main` never deploys. After `DEPLOY_ENABLED=true`, start a live deploy only with **Actions → CD → Run workflow**. That job SSHes to the VPS and runs `./deploy/deploy.sh sha-<git-sha>`.

That script:

1. Refuses the example env file and volume-destroying flags
2. Records the previous image tag
3. Backs up PostgreSQL (`pg_dump` custom format, keeps 14 dumps)
4. Pulls only `api` and `web` images
5. Runs forward-only migrations in a one-shot container
6. Recreates `api`, `web`, `retention-worker`, and `caddy`
7. Leaves Postgres (and LocalStack, if any) running
8. Health-checks live/ready/web/postgres (and LocalStack when in-cluster)
9. Rolls application images back if health checks fail

Manual:

```bash
./deploy/deploy.sh sha-<full-git-sha>
./deploy/rollback.sh
./deploy/monitor.sh
```

Rollback does not undo migrations. Keep schema changes backward compatible with the previous API image.

## 4. Migrations

- Source of truth: `backend/src/database/migrations/` (0000–0010 today)
- Runtime: `node src/database/migrate.js` inside the API image
- One container at a time (`--profile migrate run --rm`)
- Backup first (`deploy/backup.sh`)
- No down-migrations and no `DROP DATABASE`

If a migration cannot run while the old API is still serving, stop the release and fix compatibility before deploying.

## 5. Backup and restore

Dump (safe, online):

```bash
./deploy/backup.sh
```

Verify a dump without touching production tables:

```bash
./deploy/restore.sh backups/postgres-YYYYMMDDTHHMMSSZ.dump
```

That loads `company_chat_restore_check`. Drop that extra database after you are satisfied.

Replace production objects only during disaster recovery (does **not** delete volumes):

```bash
./deploy/restore.sh backups/postgres-YYYYMMDDTHHMMSSZ.dump --replace-existing
```

Schedule on the VPS (crontab as `deploy`):

```
15 2 * * * cd /opt/company-chat && ./deploy/backup.sh >> /opt/company-chat/backups/cron.log 2>&1
```

Copy dumps off-box. Object storage durability is the provider's (or the `storage_data` volume for LocalStack). Plan a second copy of S3/R2 if the provider does not already replicate.

## 6. Reverse proxy, WebSocket, media

Caddy terminates HTTPS and proxies:

- `/api/*` and `/health/*` → `api:3001` (WebSocket upgrade included, 3600s)
- `/s3/*` → in-cluster LocalStack when used
- everything else → `web:8080`

Fastify `bodyLimit` remains 1 MB. 8 MB–2 GB payloads go to S3 with presigned multipart uploads, not through the API JSON body. Caddy `request_body max_size 2GB` exists so `/s3` proxying of parts cannot be truncated.

## 7. React and Flutter

React production image leaves `VITE_API_BASE_URL` empty so the browser uses same-origin `/api` and `wss://<host>/api/v1/ws`. Do not embed server secrets in Vite variables.

Flutter defaults are emulator loopback. Release:

```bash
flutter build apk --release \
  --dart-define=API_BASE_URL=https://chat.example.com \
  --dart-define=WS_URL=wss://chat.example.com/api/v1/ws
```

`.github/workflows/mobile.yml` builds APK artifacts. It does not deploy them to the VPS. iOS needs Apple signing on a macOS runner (`IOS_BUILD_ENABLED`).

## 8. VPS hardening checklist

- Docker Engine + Compose plugin, automatic security updates
- SSH keys only, non-root `deploy` user in the `docker` group
- Firewall 22/80/443
- `.env.production` and Firebase JSON mode 600
- Log rotation via Compose `json-file` 10m × 3
- `deploy/monitor.sh` for disk, restarts, health
- Disk alerts on `/var/lib/docker` and `/opt/company-chat/backups`
- TLS via Caddy (Let's Encrypt when `CHAT_SITE` is a hostname)
- Postgres backups nightly + off-box copy
- Restore drill on `_restore_check` before you need it

## 9. Rollback

```bash
./deploy/rollback.sh
```

Restores `.previous-sha` application images with `--skip-migrate`. Postgres and S3 volumes are not touched. If a forward migration already ran and the old image cannot read the new schema, restore a database dump taken **before** that migration, still without deleting volumes.

## 10. Local validation (safe)

From the repo root, never `up` the production Compose file against the development volumes:

```powershell
docker compose --env-file deploy/.env.production.example -f docker-compose.prod.yml config --quiet
docker compose --env-file deploy/.env.production.example -f docker-compose.prod.yml -f docker-compose.prod.local-s3.yml config --quiet
docker build -t company-chat-api:local --build-arg GIT_SHA=local backend
docker build -t company-chat-web:local frontend
```

## Authorization gate

Live deploy is **not** started by this repository work. To authorize later:

1. Finish VPS bootstrap and DNS
2. Fill `.env.production` (never commit it)
3. Confirm GHCR images exist for a `sha-*` tag
4. Set GitHub environment secrets
5. Set repository variable `DEPLOY_ENABLED=true`
6. Say explicitly that production deploy is approved
