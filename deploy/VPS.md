# VPS deployment — host Nginx + host PostgreSQL

This host already serves other sites on ports 80/443 and runs PostgreSQL 16.15
on 5432. Company Chat must not start Caddy or a Postgres container.

```
GitHub Actions → GHCR sha-<commit> → VPS pulls images → Compose starts
web, api, retention-worker only
Host Nginx: web.michat.in and api.michat.in
Host PostgreSQL: company_chat / company_chat_user
```

**Do not deploy until you approve the Nginx files and environment edits.**
`DEPLOY_ENABLED` stays unset. A push to `main` never deploys.

## 1. Files on the VPS

Keep `/opt/company-chat/.env.production` (mode 600). The committed
`deploy/.env.vps.example` points `PROD_ENV_FILE` at itself so `docker compose
config` works on a developer machine. On the VPS set:

```
DEPLOY_TARGET=vps
COMPOSE_FILE=docker-compose.prod.vps.yml
PROD_ENV_FILE=.env.production
WEB_HOST_PORT=3046
API_HOST_PORT=3045
POSTGRES_USER=company_chat_user
POSTGRES_DB=company_chat
POSTGRES_DUMP_HOST=127.0.0.1
POSTGRES_DUMP_PORT=5432
DATABASE_URL=postgresql://company_chat_user:URL_ENCODED_PASSWORD@host.docker.internal:5432/company_chat
CORS_ORIGINS=https://web.michat.in
TRUST_PROXY=1
STORAGE_IN_CLUSTER=0
FIREBASE_SECRET_PATH=./secrets/firebase-service-account.json
```

Leave JWT, SMS, S3, and the database password as they already are. URL-encode
the password inside `DATABASE_URL` if it contains `@`, `:`, `/`, `#`, or `%`.

Do not set the database host to `172.17.0.1`. Use `host.docker.internal`.

## 2. Ports to check before first start

```bash
ss -lntup | grep -E ':80|:443|:5432|:3045|:3046'
```

Defaults: web `127.0.0.1:3046`, API `127.0.0.1:3045`. Change `WEB_HOST_PORT`
and `API_HOST_PORT` if either is taken, and match the Nginx upstreams.

## 3. PostgreSQL from a container (manual)

A connection from the VPS shell to `127.0.0.1:5432` does **not** prove a
container can connect. After the API container exists, test from inside it:

```bash
cd /opt/company-chat
docker compose --env-file .env.production -f docker-compose.prod.vps.yml exec -T api \
  node -e "fetch('http://127.0.0.1:3001/health/ready',{signal:AbortSignal.timeout(4000)}).then(async r=>{console.log(await r.text()); process.exit(r.ok?0:1)})"
```

If ready stays `DATABASE_UNAVAILABLE`, inspect (do not apply yet):

1. `listen_addresses` in PostgreSQL must accept the Docker host-gateway, not
   only `localhost`.
2. `pg_hba.conf` must allow `company_chat_user` from the Docker bridge range,
   commonly `172.16.0.0/12` or `172.17.0.0/16`, to database `company_chat`.

Example lines for **manual approval only** (do not apply automatically):

```
# postgresql.conf
# listen_addresses = 'localhost,172.17.0.1'

# pg_hba.conf
# host company_chat company_chat_user 172.16.0.0/12 scram-sha-256
```

Reload PostgreSQL only after you approve those lines. Do not open 5432 on the
public interface.

## 4. Nginx (manual)

Prepared files:

- `deploy/nginx/web.michat.in.conf`
- `deploy/nginx/api.michat.in.conf`

They do not use `default_server` and do not mention `michat.in`.

```bash
sudo cp /opt/company-chat/deploy/nginx/web.michat.in.conf /etc/nginx/sites-available/web.michat.in
sudo cp /opt/company-chat/deploy/nginx/api.michat.in.conf /etc/nginx/sites-available/api.michat.in
sudo nginx -t
```

Stop there until you approve. Then obtain certificates, enable the sites, and
reload Nginx yourself. Do not reload from deploy scripts.

DNS A/AAAA records for `web.michat.in` and `api.michat.in` must point at this
VPS. Leave `michat.in` unchanged.

## 5. First application start (after images and env are ready)

```bash
cd /opt/company-chat
docker compose --env-file .env.production -f docker-compose.prod.vps.yml pull api web
./deploy/backup.sh
docker compose --env-file .env.production -f docker-compose.prod.vps.yml --profile migrate run --rm --no-deps migrate
./deploy/deploy.sh sha-<git-sha>
./deploy/healthcheck.sh
```

`deploy.sh` starts only `api`, `web`, and `retention-worker`. It never starts
Caddy or PostgreSQL.

## 6. React and Flutter origins

The SPA is on `https://web.michat.in` and the API on `https://api.michat.in`.
CD bakes `VITE_API_BASE_URL=https://api.michat.in` into the web image (override
with GitHub variable `PUBLIC_API_ORIGIN`). Images published before that
build-arg will call same-origin `/api` on the web host and will not work.

Flutter release:

```
--dart-define=API_BASE_URL=https://api.michat.in
--dart-define=WS_URL=wss://api.michat.in/api/v1/ws
```

## 7. Backups

`./deploy/backup.sh` dumps **only** `company_chat` through host `pg_dump` to
`127.0.0.1:5432`. Install `postgresql-client-16` if `pg_dump` is missing.
Restore never targets `postgres`, `template0`, `template1`, or any other
database.
