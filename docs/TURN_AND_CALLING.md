# MiChat voice calling — TURN, platforms, and rollout

Voice calling is implemented in the Fastify API, the React web client, and the Flutter client. **Live production remains off until TURN is installed and `CALLS_ENABLED=true` is copied into the VPS env.** Messaging and S3 attachments continue to work when calling is disabled.

## What is implemented

- Authenticated REST call lifecycle for **live** calls only
- In-memory call state with expiry and purge; no `calls` table and no call history
- Authenticated WebSocket signaling (`call.offer`, `call.answer`, `call.ice_candidate`) that is relayed, never stored
- Short-lived TURN credentials issued by the API (coturn REST / HMAC)
- Flutter 1-to-1 audio via WebRTC, mute, speaker, incoming overlay
- Web 1-to-1 audio via RTCPeerConnection, mute, speaker, incoming overlay
- Android high-priority incoming-call notification (full-screen intent when permitted)
- No recording, no S3/media persistence, no downloadable call audio
- S3 is unused by calling; TURN relays live media only and does not record

## What is not claimed complete

- TURN is **not** installed on the production VPS
- Real-device calling across Wi-Fi / mobile data / NAT is **unverified**
- iOS CallKit + PushKit VoIP incoming-on-lock-screen is **not** enabled (Apple rejects `voip` background mode without a PushKit certificate and CallKit UI)
- Android ConnectionService / Telecom is **not** used; background incoming calls use FCM + a full-screen notification

## Recommended TURN (do not install on the shared VPS without approval)

The production host already runs unrelated sites. Do **not**:

- Overwrite Nginx
- Change SSH accounts
- Modify unrelated Docker containers
- Reconfigure PostgreSQL globally
- Open firewall ports without explicit approval
- Install coturn on the existing production Docker Compose stack

Use a **dedicated** small VM or a managed TURN provider.

Required public ports (typical coturn):

| Port | Protocol | Purpose |
| --- | --- | --- |
| 3478 | UDP + TCP | STUN / TURN allocation |
| 5349 | TCP | TURNS (TLS) |
| 49152–65535 | UDP | Relay media (can be narrowed) |

TLS certificate: a dedicated hostname such as `turn.michat.in`, not the API certificate reused in a way that breaks Nginx.

coturn `static-auth-secret` must match API `TURN_SECRET`. The API mints `username = expiry:userId` and `credential = HMAC-SHA1(secret, username)`.

Example compose file (opt-in only): `scripts/turn/docker-compose.turn.yml`

API environment after TURN is approved:

```
CALLS_ENABLED=true
STUN_URLS=stun:turn.michat.in:3478
TURN_URLS=turn:turn.michat.in:3478?transport=udp,turn:turn.michat.in:3478?transport=tcp,turns:turn.michat.in:5349
TURN_SECRET=<coturn static-auth-secret>
TURN_REALM=michat
```

Never put `TURN_SECRET` in the Flutter app or in push payloads.

## iOS prerequisites for lock-screen VoIP (future)

1. Apple Developer account with Push Notifications + Voice over IP
2. VoIP services certificate / PushKit token
3. CallKit incoming UI (required if `voip` is in `UIBackgroundModes`)
4. App Store review justification for microphone + VoIP

Until that is in place, iOS incoming calls work when the app is open or recently backgrounded via FCM; terminated/lock-screen VoIP is not reliable.

## Android permissions already added

- `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH_CONNECT`
- `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MICROPHONE` (active call)
- `USE_FULL_SCREEN_INTENT`, `WAKE_LOCK`, `POST_NOTIFICATIONS`

## Staged production rollout

1. Test locally with `CALLS_ENABLED` on (calling uses in-memory state; no call-history migration)
2. Deploy API with `CALLS_ENABLED` unset/false (default in production)
3. Stand up TURN after approval
4. Enable `CALLS_ENABLED=true` on API only
5. Ship a Flutter build that already hides call buttons when capabilities.enabled is false
6. Real-device matrix: Android↔Android, Android↔iPhone, iPhone↔iPhone, Wi-Fi↔mobile data
