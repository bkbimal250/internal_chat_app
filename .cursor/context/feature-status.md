# Feature status

Historical context for this checkout. Verify in code before treating as current behavior. Update only when a feature's actual status changes.

## Implemented

- Direct and group messaging
- Admin-created users; login by username/password and phone OTP
- Multiple device sessions and session revocation
- Read receipts and typing indicators (other users, not self)
- Presence
- Notifications, with suppression while the matching chat is actively viewed
- Private AWS S3 attachments, including multipart upload
- Up-to-50 mixed-file selection/upload
- MiChat-generated attachment filenames
- Web-only ZIP Download All
- Individual attachment download on web and mobile
- Live foreground WebRTC audio calling (TURN from backend)
- Flutter Android app (`com.companychat.company_chat`)

## Incomplete or unverified

- Android session persistence after close/reopen (user-reported logout / restoring-session loop)
- Missing Android conversation-list avatars (user-reported)
- Android chat-list and chat-screen performance (user-reported)
- iOS PushKit/CallKit and background calling
- iOS production release

## Explicitly out of scope unless requested

- Call recording
- Persistent call history
- ZIP Download All on mobile
- Weakening session, device, or S3 access controls
