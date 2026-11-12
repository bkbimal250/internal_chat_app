# Architecture map

Navigation index. Read the listed file first; do not dump the directory.

## Backend

- App bootstrap: `backend/src/app.js`
- Auth routes/service: `backend/src/modules/auth/auth.routes.js`, `backend/src/modules/auth/auth.service.js`
- WebSocket gateway/auth/events: `backend/src/websocket/gateway.js`, `backend/src/websocket/websocket-auth.js`, `backend/src/websocket/event-handler.js`
- Conversations: `backend/src/modules/conversations/conversations.routes.js`, `backend/src/modules/conversations/conversations.service.js`
- Messages: `backend/src/modules/messages/messages.routes.js`, `backend/src/modules/messages/messages.controller.js`
- Attachments/S3: `backend/src/modules/attachments/attachments.routes.js`, `backend/src/services/object-storage.service.js`
- Calls/ICE: `backend/src/modules/calls/calls.routes.js`, `backend/src/modules/calls/ice-config.js`
- Users/photos: `backend/src/modules/users/users.routes.js`
- Groups: `backend/src/modules/groups/groups.routes.js`

## Web

- Entry/router: `frontend/src/main.jsx`, `frontend/src/app/router.jsx`, `frontend/src/app/providers.jsx`
- Auth store/UI: `frontend/src/stores/auth-store.js`, `frontend/src/features/auth/LoginForm.jsx`
- Realtime: `frontend/src/features/realtime/RealtimeProvider.jsx`
- Conversation list/sidebar: `frontend/src/features/conversations/ConversationList.jsx`, `frontend/src/features/conversations/ConversationSidebar.jsx`, `frontend/src/layouts/AppSidebar.jsx`
- Message composer/attachments: `frontend/src/features/messages/MessagePane.jsx`, `frontend/src/features/messages/AttachMenu.jsx`, `frontend/src/features/messages/attachment-upload.js`
- Settings: `frontend/src/features/settings/SettingsShell.jsx`
- Web calling UI: not mapped yet

## Flutter (`mobile/company_chat`)

- Startup: `lib/main.dart`, `lib/app/app.dart`, `lib/app/router.dart`
- Auth/session: `lib/features/auth/presentation/auth_controller.dart`, `lib/core/storage/session_store.dart`, `lib/core/network/api_client.dart`
- Conversation list: `lib/features/conversations/presentation/chats_screen.dart`, `lib/features/conversations/presentation/conversations_controller.dart`
- Avatars: `lib/core/widgets/user_avatar.dart`
- Chat: `lib/features/messages/presentation/chat_screen.dart`, `lib/features/messages/presentation/messages_controller.dart`
- Notifications: `lib/core/notifications/push_notifications.dart`, `lib/core/notifications/notification_coordinator.dart`
- Calling: `lib/features/calls/call_controller.dart`, `lib/features/calls/call_host.dart`

## Deploy

- CD workflow: `.github/workflows/cd.yml`
- Deploy scripts: `deploy/deploy.sh`, `deploy/rollback.sh`
- VPS notes: `deploy/VPS.md`
