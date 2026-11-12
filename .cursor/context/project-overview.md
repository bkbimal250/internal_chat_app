# MiChat overview

Private company chat for authenticated employees. Not a public messenger.

## Stack

- Backend: Node.js, Fastify, PostgreSQL, Drizzle ORM
- Web: React, Vite, JavaScript, Tailwind CSS
- Mobile: Flutter/Dart (`mobile/company_chat`); Android first, iOS deferred
- Realtime: authenticated WebSocket
- Files: private AWS S3 (`michat-main-bucket`, `ap-south-1`)
- Calls: live WebRTC audio; TURN at `turn.michat.in`

## Locations

- API: `backend/`
- Web: `frontend/`
- Flutter: `mobile/company_chat/`
- Deploy: `deploy/`, `.github/workflows/`
- Production: API `https://api.michat.in`, web `https://web.michat.in`, VPS `/opt/company-chat`

## Auth

Native clients send `clientType: native` with rotating refresh tokens stored in platform secure storage. Web uses session cookies plus CSRF. Access tokens are short-lived JWT. Refresh reuse (`refresh_reuse`) revokes the device session family. Admin-created accounts; users do not self-register.

## Realtime

WebSocket path `/api/v1/ws`. Connect only with a valid access token. Events cover messages, receipts, typing, presence, conversation/group updates, and live call signaling. Duplicate client handling should ignore already-applied event ids where present.

## Attachments

Uploads go through authenticated APIs, then private S3 (multipart for large files). Clients receive presigned GET URLs, not raw object keys or AWS credentials. MiChat generates display filenames. Web may ZIP-download a message's attachments. Mobile downloads files individually; no ZIP Download All.

## Calls

Foreground 1:1 voice only. ICE/TURN credentials come from the authenticated backend. Do not persist recordings, call audio, or call history.
