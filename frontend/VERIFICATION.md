# Frontend verification

## Phase 5 — secure media and file sharing — 29 October 2026

- Composer paperclip, hidden file input, drag-and-drop overlay, XHR upload
  progress with cancel/retry, image lightbox, video/audio controls, and
  PDF/document cards are wired to the existing Fastify attachment APIs.
- Playwright talks to Vite at `http://127.0.0.1:5173` and the API at
  `http://127.0.0.1:3001`. Isolated `e2e.{runId}.*` accounts are seeded; the
  Docker Postgres volume is not reset.
- `e2e/media.spec.js` uploads a PNG from one employee, confirms the peer
  receives it over WebSocket, and opens the lightbox.

### Results

- ESLint: 0 errors (3 pre-existing shadcn `react-refresh/only-export-components` warnings).
- Vitest: 16 passed, 0 failed.
- `vite build`: succeeded.
- Playwright: 17 passed, 0 failed (auth, chat, groups, admin, responsive, media).
- `npm audit`: 0 vulnerabilities.
- Calling and Flutter were not implemented.

**Phase 5 frontend: PASS.**

## Profile photos and avatars — 30 October 2026

- shadcn `UserAvatar` now loads signed photo URLs lazily, falls back to
  initials or a group icon, shows online dots, tooltips, and a pulse skeleton
  while a URL is fetched.
- Settings → Your info supports preview, change, and remove. The admin employee
  table and edit dialog use the same editor. Conversation lists, chat headers,
  group members, group message senders, directory, new-chat dialogs, and the
  account rail all render photos.
- `user.updated` WebSocket events patch conversation/directory caches and bust
  `photo-url` queries so a new photo is not shown from a stale signed URL.

### Results

- ESLint: 0 errors (4 pre-existing shadcn `react-refresh/only-export-components` warnings).
- Vitest: 30 passed, 0 failed.
- `vite build`: succeeded.
- Playwright: 25 passed, 0 failed, including `e2e/profile-photos.spec.js`
  (upload, peer conversation/directory display, initials after remove, 403 on
  admin photo init).
- Docker Postgres volume was not reset.

**Profile photos frontend: PASS.**
