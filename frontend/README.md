# Company Chat — Frontend

React + Vite JavaScript SPA for internal company messaging. It talks to the
Fastify API over cookie/CSRF REST and a browser-safe WebSocket handshake.

## Requirements

- Node.js 22+
- API at `http://127.0.0.1:3001`
- Backend `CORS_ORIGINS=http://127.0.0.1:5173`

Bind Vite to **`127.0.0.1`**, not `localhost`, so `SameSite=Strict` cookies stay
first-party.

## Setup

```powershell
cd frontend
Copy-Item .env.example .env
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`.

## Environment

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | API origin, default `http://127.0.0.1:3001` |

WebSocket URL is derived by replacing `http` with `ws` and appending `/api/v1/ws`.

## Commands

```powershell
npm run dev
npm run build
npm run preview
npm run lint
npm test
npm run test:e2e:install
npm run test:e2e
npm audit
```

## Architecture

```
src/app            providers, router, root
src/layouts        auth shell and WhatsApp-style workspace shell
src/pages          route screens
src/features       auth, conversations, messages, groups, users, admin, realtime
src/components     shadcn/ui primitives and shared chrome
src/services       Axios client, REST modules, WebSocket manager
src/stores         auth, UI, presence, typing
src/lib            query keys, message cache, permissions, time, realtime reducer
src/hooks          auth and media-query helpers
src/config         VITE_* configuration
src/styles         Tailwind theme
```

TanStack Query holds server state. Zustand holds session tokens (memory only),
composer UI, presence, and typing. Routes for admin, directory, groups, and
settings are lazy-loaded.

## Authentication

1. Browser login posts `clientType: "web"` and `platform: "web"`.
2. Refresh uses the HTTP-only `chat_refresh` cookie plus `X-CSRF-Token`.
3. Access tokens stay in memory. They are never written to `localStorage`.
4. First-login accounts are sent to `/change-password` before chat.
5. 401 responses share a single refresh; a failed refresh returns to login.

## API and WebSocket

REST uses Axios with credentials, `X-Requested-With: company-chat`, and CSRF on
mutating requests.

Browsers cannot set `Authorization` on `WebSocket`. The client opens:

```js
new WebSocket(wsUrl, ['company-chat', accessToken])
```

The API reads the JWT from `Sec-WebSocket-Protocol` (and still accepts
`Authorization` for native/Node clients). Close `4001` tries one token refresh
before signing out. After `connection.ready` on reconnect, open conversations
are synced with `afterChangeSeq` and `afterSeq`, upserted by message `id`.

## Testing

`npm test` runs Vitest against message upsert/sync, conversation filters, group
permissions, WebSocket reducers, route guards, and navigation labels.

### Browser end-to-end

Playwright talks to the live Fastify API at `http://127.0.0.1:3001` and the Vite
app at **`http://127.0.0.1:5173`**. Do not use `localhost`; `SameSite=Strict`
cookies will not attach.

```powershell
npm run test:e2e:install
npm run test:e2e
```

Global setup checks `/health/ready`, then seeds isolated `e2e.{runId}.*`
employees inside the API container. Passwords stay in gitignored
`e2e/.auth/accounts.json`. Production and development rows in the Docker
Postgres volume are left untouched.

The suite covers employee login, logout, session restore, first-login password
change, realtime DM exchange, delivery/read ticks, typing and online status,
reply/edit/delete/forward, group create/membership, owner promote/transfer/leave,
multi-device sync, disconnect recovery, admin create/suspend/reactivate/reset/
revoke/audit, unauthorized admin access, desktop/tablet/mobile layout,
authorized image attachment upload with realtime delivery and lightbox, and
profile photo upload, display, peer sync, initials fallback, and unauthorized
admin photo rejection.

Circular `UserAvatar` photos use the shadcn Avatar primitive. Employees upload
or remove photos in Settings → Your info. Directory, conversation lists, chat
headers, group members, message senders, the account rail, and the admin table
load signed photo URLs lazily and fall back to initials or a group icon.

The API CORS policy must allow `GET, HEAD, POST, PUT, PATCH, DELETE` from
`http://127.0.0.1:5173`. `@fastify/cors` defaults to GET/HEAD/POST only, which
blocks message edit, group role changes, and session revoke in the browser.
Presigned uploads go to LocalStack at `http://127.0.0.1:4566`; keep
`S3_PUBLIC_ENDPOINT` on that host so the browser can PUT/GET objects.

Calling and Flutter remain out of scope.

## Attachments

The composer paperclip and drag-and-drop upload through presigned S3 URLs.
Images are canvas-compressed; browser video under 80 MB can be re-encoded when
that shrinks the file; PDFs, ZIPs, and Office documents are never recompressed.
Files over 8 MB use resumable 8 MB multipart parts with retry. The progress card
shows percent, transferred bytes, and an ETA. After finalize, messages include
public attachment metadata (never storage keys). Images open in a lightbox;
video and audio use native controls; documents render as download cards.
