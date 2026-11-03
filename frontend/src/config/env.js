export function resolveApiBaseUrl({
  viteApiBaseUrl = import.meta.env.VITE_API_BASE_URL,
  isProd = import.meta.env.PROD,
} = {}) {
  const configured = String(viteApiBaseUrl || '').trim()
  if (configured) return configured.replace(/\/$/, '')
  if (isProd) return ''
  return 'http://127.0.0.1:3001'
}

export function resolveWsUrl(apiBaseUrl, location) {
  if (apiBaseUrl) return `${apiBaseUrl.replace(/^http/i, 'ws')}/api/v1/ws`
  const host = location?.host
  if (host) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${host}/api/v1/ws`
  }
  return '/api/v1/ws'
}

const apiBaseUrl = resolveApiBaseUrl()

export const appConfig = Object.freeze({
  apiBaseUrl,
  apiPrefix: '/api/v1',
  wsUrl: resolveWsUrl(apiBaseUrl, typeof window === 'undefined' ? undefined : window.location),
  requestedWith: 'company-chat',
  csrfCookieName: 'chat_csrf',
})
