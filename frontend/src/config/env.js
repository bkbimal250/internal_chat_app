const apiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001').replace(
  /\/$/,
  '',
)

export const appConfig = Object.freeze({
  apiBaseUrl,
  apiPrefix: '/api/v1',
  wsUrl: `${apiBaseUrl.replace(/^http/i, 'ws')}/api/v1/ws`,
  requestedWith: 'company-chat',
  csrfCookieName: 'chat_csrf',
})
