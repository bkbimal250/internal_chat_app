# internal_chat_app

Local development still uses `docker-compose.yml` (builds from source).
Production images, GitHub Actions, and VPS pull-only deploy:

- `PRODUCTION_AUDIT.md` — readiness, blockers, and unverified items
- `PRODUCTION_CREDENTIALS_CHECKLIST.md` — every secret and where it lives
- `DEPLOYMENT_GUIDE.md` — GitHub → GHCR → VPS procedure
- `docker-compose.prod.yml` — image-only production Compose (no `build:`) 
