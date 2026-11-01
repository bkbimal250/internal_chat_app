# Company Chat mobile

Flutter client for the existing Company Chat Fastify API. Admin and employee accounts sign in through the same app. After login, Admin-only navigation appears when `user.role == admin`. Backend authorization remains authoritative.

## Run

The API must already be running (`docker compose up -d` from the repo root). Do not reset Docker volumes.

```powershell
cd mobile/company_chat
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001
```

- Android emulator: `http://10.0.2.2:3001` (default on Android)
- iOS Simulator: `http://127.0.0.1:3001`
- Physical device: the Windows host LAN IP, for example `http://192.168.1.20:3001`

Override WebSocket separately if needed:

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
