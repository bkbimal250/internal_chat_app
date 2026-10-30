import { appConfig } from '@/config/env'

let accessToken = null
let csrfToken = null
const listeners = new Set()

function emit(event, detail) {
  for (const listener of listeners) listener(event, detail)
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

export function applyTokens({ accessToken: nextAccess = null, csrfToken: nextCsrf = null } = {}) {
  accessToken = nextAccess
  csrfToken = nextCsrf || readCsrfCookie()
  emit('tokens', { accessToken, csrfToken })
}

export function clearTokens() {
  accessToken = null
  csrfToken = null
  emit('cleared')
}
