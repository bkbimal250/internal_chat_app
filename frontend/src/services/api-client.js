import axios from 'axios'
import { appConfig } from '@/config/env'
import { toApiError } from '@/services/api-error'
import {
  applyTokens,
  clearTokens,
  getAccessToken,
  getCsrfToken,
} from '@/services/session-tokens'

const mutatingMethods = new Set(['post', 'put', 'patch', 'delete'])

function isAuthRefreshUrl(url = '') {
  return url.includes('/api/v1/auth/refresh')
}

function isAuthLoginUrl(url = '') {
  return url.includes('/api/v1/auth/login') || url.includes('/api/v1/auth/otp/')
}

export function isAuthFailure(error) {
  const status = error?.status ?? error?.response?.status
  return status === 401 || status === 403
}

function attachCommonHeaders(config) {
  config.headers = config.headers ?? {}
  config.headers['X-Requested-With'] = appConfig.requestedWith

  const token = getAccessToken()
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`
  }

  const method = String(config.method || 'get').toLowerCase()
  if (mutatingMethods.has(method)) {
    const csrf = getCsrfToken()
    if (csrf && !config.headers['X-CSRF-Token']) {
      config.headers['X-CSRF-Token'] = csrf
    }
  }

  return config
}

export const rawClient = axios.create({
  baseURL: appConfig.apiBaseUrl,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'X-Requested-With': appConfig.requestedWith,
  },
})

rawClient.interceptors.request.use(attachCommonHeaders)

export const apiClient = axios.create({
  baseURL: appConfig.apiBaseUrl,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'X-Requested-With': appConfig.requestedWith,
  },
})

apiClient.interceptors.request.use(attachCommonHeaders)

let refreshPromise = null

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = rawClient
      .post('/api/v1/auth/refresh', { clientType: 'web' })
      .then((response) => {
        applyTokens(
          {
            accessToken: response.data.accessToken,
            csrfToken: response.data.csrfToken,
          },
          response.data,
        )
        return response.data
      })
      .catch((error) => {
        const apiError = toApiError(error)
        if (isAuthFailure(apiError)) clearTokens()
        throw apiError
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const status = error.response?.status
    const url = original?.url || ''

    if (
      status === 401 &&
      original &&
      !original._retry &&
      !isAuthRefreshUrl(url) &&
      !isAuthLoginUrl(url)
    ) {
      original._retry = true
      try {
        const session = await refreshAccessToken()
        original.headers = original.headers ?? {}
        original.headers.Authorization = `Bearer ${session.accessToken}`
        if (session.csrfToken) original.headers['X-CSRF-Token'] = session.csrfToken
        return apiClient(original)
      } catch (refreshError) {
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(toApiError(error))
  },
)
