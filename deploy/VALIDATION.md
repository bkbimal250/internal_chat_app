# CI/CD validation report

Date: 2026-11-03  
Scope: local pipeline preparation only. No VPS was contacted and no live deploy was attempted.

## Passed locally

| Check | Result |
| --- | --- |
| `docker compose -f docker-compose.yml config` | Valid. Existing local stack unchanged. |
| `docker compose --env-file deploy/.env.production.example -f docker-compose.prod.yml config` | Valid. Project name `internal-chat`. No application `build:` keys. |
| Overlay `docker-compose.prod.local-s3.yml` | Valid. |
| Public ports | Caddy `80` and `443` only. Postgres unpublished. LocalStack unpublished unless the overlay is used, and still not published. |
| Git Bash `bash -n` | `lib.sh`, `deploy.sh`, `rollback.sh`, `backup.sh`, `healthcheck.sh`, `monitor.sh`, `restore.sh` parse cleanly. |
| Backend lint | Pass after unused-variable fixes. |
| Backend tests | 36 passed, 24 skipped (need `TEST_DATABASE_URL` `*_test`). 0 failed. Includes `S3_CREATE_BUCKET` production default. |
| Frontend tests | 65 passed. |
| Frontend lint | 0 errors, 5 existing react-refresh warnings in shadcn/ui files. |
| Frontend `vite build` | Succeeded. |
| Backend image `company-chat-api:local` | Builds. User `node`. `migrate.js` and retention worker present. `.env` absent. `src/tests` omitted. |
| Frontend image `company-chat-web:local` | Builds. User `nginx`. Isolated `--read-only --tmpfs /tmp`: `GET /healthz` → `ok`, SPA root HTML served. |
| Local running API (existing dev stack, not rebuilt) | `/health/live` ok, `/health/ready` database connected, storage connected. |
| Local retention worker | `preview-until-approved`. Destructive cleanup not activated. |
| Destructive commands | Not run. No `compose down -v`, volume prune, database reset, or S3 delete. |

## Not verified (requires GitHub / VPS / your credentials)

- GHCR login and image push from GitHub Actions
- `production` environment protection and secret wiring
- SSH as the restricted deploy user
- Let's Encrypt certificates and live WSS
- Hilite SMS in production
- Firebase push against the production hostname
- External AWS S3 / R2 / MinIO
- S3 upload/download through `https://<host>/s3`
- Automatic rollback after a failed health check
- Session restore across a real API container replace
- Live 100 MB–2 GB transfers
- `TEST_DATABASE_URL` integration tests

Do not set repository variable `DEPLOY_ENABLED=true` until the VPS bootstrap in `DEPLOYMENT_GUIDE.md` is finished and you explicitly authorize deploy.

## Safety notes

- Production Compose reuses project name `internal-chat` so existing employee data stays attached. Do not `up` that file on the development machine.
- `deploy/deploy.sh` refuses the example env file and refuses Compose volume-destroying flags.
- Image rollback does not undo Drizzle migrations. Keep schema changes backward compatible.
- A single API container still drops WebSocket clients for a few seconds during replace. Clients reconnect; this is not blue-green.
