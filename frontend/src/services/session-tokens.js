import { appConfig } from '@/config/env'

const AUTH_CHANNEL = 'michat-auth'
const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

let accessToken = null
let csrfToken = null
let authChannel
const listeners = new Set()

function emit(event, detail) {
  for (const listener of listeners) listener(event, detail)
}

function getAuthChannel() {
  if (authChannel !== undefined) return authChannel
  if (typeof BroadcastChannel === 'undefined') {
    authChannel = null
    return authChannel
  }
  try {
    authChannel = new BroadcastChannel(AUTH_CHANNEL)
    authChannel.addEventListener('message', (event) => {
      const data = event.data
      if (!data || data.source === tabId) return
      if (data.type === 'tokens') {
        applyTokens(data.tokens, data.extra, { broadcast: false })
      }
      if (data.type === 'cleared') {
        clearTokens({ broadcast: false })
      }
    })
  } catch {
    authChannel = null
  }
  return authChannel
}

function broadcast(payload) {
  getAuthChannel()?.postMessage({ ...payload, source: tabId })
}

export function subscribeSession(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAccessToken() {
  return accessToken
}

export function getCsrfToken() {
  return csrfToken || readCsrfCookie()
}

export function readCsrfCookie() {
  if (typeof document === 'undefined') return null
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=')
    if (name === appConfig.csrfCookieName) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return null
}

export function applyTokens(
  { accessToken: nextAccess = null, csrfToken: nextCsrf = null } = {},
  extra = null,
  { broadcast: shouldBroadcast = true } = {},
) {
  accessToken = nextAccess
  csrfToken = nextCsrf || readCsrfCookie()
  emit('tokens', { accessToken, csrfToken })
  if (extra) emit('refreshed', extra)
  if (shouldBroadcast) {
    broadcast({
      type: 'tokens',
      tokens: { accessToken, csrfToken },
      extra,
    })
  }
}

export function clearTokens({ broadcast: shouldBroadcast = true } = {}) {
  accessToken = null
  csrfToken = null
  emit('cleared')
  if (shouldBroadcast) broadcast({ type: 'cleared' })
}
