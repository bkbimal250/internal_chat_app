# Company Chat mobile

Flutter client for the existing Company Chat Fastify API. Admin and employee accounts sign in through the same app. After login, Admin-only navigation appears when `user.role == admin`. Backend authorization remains authoritative.

## Run

The API must already be running (`docker compose up -d` from the repo root). Do not reset Docker volumes.

```powershell
cd mobile/company_chat
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

- Android emulator (debug): `http://10.0.2.2:3001` (default on Android)
- iOS Simulator (debug): `http://127.0.0.1:3001`
- Production: `https://api.michat.in` (default for release builds)

Production builds must use HTTPS/WSS and never localhost, `10.0.2.2`, or a VPS IP:

```powershell
flutter run --release --dart-define=API_BASE_URL=https://api.michat.in --dart-define=WS_URL=wss://api.michat.in/api/v1/ws
flutter build apk --release --dart-define=API_BASE_URL=https://api.michat.in --dart-define=WS_URL=wss://api.michat.in/api/v1/ws
```

Debug WebSocket override against a local API:

```powershell
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001 --dart-define=WS_URL=ws://10.0.2.2:3001/api/v1/ws
```

## Auth

Native login sends `clientType: native` plus platform, device name, and a stable `deviceId`. The refresh token is stored in platform secure storage. Access tokens stay in memory and rotate through `/api/v1/auth/refresh` with single-flight refresh.

WebSocket connects to `/api/v1/ws` with the `company-chat` subprotocol and a Bearer JWT.

## Media

Photos and videos are compressed on-device with adaptive H.264/JPEG settings.
Documents, ZIP files, and PDFs are never recompressed. Uploads over 8 MB use
resumable S3 multipart chunks. Keep the app open during large transfers;
iOS and Android will pause uploads if the process is killed.

- Images: JPEG/PNG/WebP/GIF, 25 MB after compression
- Video: MP4/WebM/QuickTime originals up to 2 GB
- Audio: 100 MB
- PDF/ZIP/Office: 2 GB
- Plain text: 8 MB

## Checks

```powershell
flutter analyze
flutter test
flutter build apk --debug
```
