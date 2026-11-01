export const WORKSPACE_STORAGE_KEY = 'company-chat.workspace'
export const WORKSPACE_VIEWS = ['chats', 'directory', 'groups', 'settings', 'admin']
export const DEFAULT_WORKSPACE = { view: 'chats', conversationId: null }

const VIEW_SET = new Set(WORKSPACE_VIEWS)
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const LEGACY_VIEWS = {
  '/directory': 'directory',
  '/groups': 'groups',
  '/settings': 'settings',
  '/admin': 'admin',
}

export function isWorkspaceView(value) {
  return VIEW_SET.has(value)
}

export function isConversationId(value) {
  return typeof value === 'string' && UUID.test(value)
}

export function normalizeWorkspace(input = {}, { allowAdmin = false } = {}) {
  const view = isWorkspaceView(input.view) ? input.view : 'chats'
  const conversationId = isConversationId(input.conversationId) ? input.conversationId : null
  return {
    view: view === 'admin' && !allowAdmin ? 'chats' : view,
    conversationId,
  }
}

export function workspaceEquals(left, right) {
  return left?.view === right?.view && left?.conversationId === right?.conversationId
}

export function readWorkspaceSession() {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      view: parsed.view,
      conversationId: parsed.conversationId ?? null,
    }
  } catch {
    return null
  }
}

export function writeWorkspaceSession(entry) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        view: entry.view,
        conversationId: entry.conversationId,
      }),
    )
  } catch {
    // Ignore quota or private-mode failures.
  }
}

export function clearWorkspaceSession() {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(WORKSPACE_STORAGE_KEY)
  } catch {
    // Ignore storage access failures.
  }
}

export function fromLegacyPath(pathname) {
  if (!pathname || pathname === '/') return DEFAULT_WORKSPACE
  const chat = pathname.match(/^\/c\/([^/]+)\/?$/)
  if (chat) return { view: 'chats', conversationId: chat[1] }
  const view = LEGACY_VIEWS[pathname.replace(/\/$/, '')]
  if (view) return { view, conversationId: null }
  return null
}

export function syncWorkspaceHistory(entry, mode = 'push') {
  if (typeof window === 'undefined' || mode === 'none') return
  const current = window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
  const payload = { ...current, workspace: entry }
  if (mode === 'replace') window.history.replaceState(payload, '', '/')
  else window.history.pushState(payload, '', '/')
}
