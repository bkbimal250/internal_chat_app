import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apiClient, rawClient } from '@/services/api-client'
import { clearTokens, getAccessToken, getCsrfToken } from '@/services/session-tokens'
import { useAuthStore } from '@/stores/auth-store'

function jsonResponse(config, data, status = 200) {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config,
    request: {},
  }
}

function axiosError(config, { status, code, message, network = false }) {
  if (network) {
    return new AxiosError('network', 'ERR_NETWORK', config, {}, undefined)
  }
  return new AxiosError(
    message || 'request failed',
    'ERR_BAD_REQUEST',
    config,
    {},
    {
      status,
      statusText: 'Error',
      data: { error: { code, message: message || code, requestId: 't' } },
      headers: {},
      config,
    },
  )
}

const sessionUser = {
  id: 'user-1',
  username: 'ada',
  displayName: 'Ada',
  role: 'employee',
  mustChangePassword: false,
}

const adminUser = {
  ...sessionUser,
  id: 'admin-1',
  username: 'admin',
  displayName: 'Admin',
  role: 'admin',
}

const refreshPayload = {
  accessToken: 'access-1',
  csrfToken: 'csrf-1',
  expiresIn: 900,
  sessionId: 'sid-1',
  deviceId: 'dev-1',
  user: sessionUser,
}

describe('auth session restoration', () => {
  beforeEach(() => {
    document.cookie = 'chat_csrf=; max-age=0; path=/'
    clearTokens()
    useAuthStore.setState({
      status: 'initializing',
      user: null,
      accessToken: null,
      csrfToken: null,
      sessionId: null,
      deviceId: null,
      expiresAt: null,
    })
  })

  afterEach(() => {
    rawClient.defaults.adapter = undefined
    apiClient.defaults.adapter = undefined
    useAuthStore.getState().reset()
    clearTokens()
  })

  it('restores a session without a JS-readable CSRF cookie', async () => {
    expect(getCsrfToken()).toBeNull()
    rawClient.defaults.adapter = async (config) => jsonResponse(config, refreshPayload)
    apiClient.defaults.adapter = async (config) => {
      if (String(config.url).includes('/auth/me')) return jsonResponse(config, sessionUser)
      return jsonResponse(config, { ok: true })
    }

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user).toEqual(sessionUser)
    expect(getAccessToken()).toBe('access-1')
    expect(getCsrfToken()).toBe('csrf-1')
  })

  it('restores the admin role from the profile endpoint', async () => {
    rawClient.defaults.adapter = async (config) => jsonResponse(config, refreshPayload)
    apiClient.defaults.adapter = async (config) => jsonResponse(config, adminUser)

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user.role).toBe('admin')
  })

  it('becomes unauthenticated when the refresh cookie is rejected', async () => {
    rawClient.defaults.adapter = async (config) => {
      throw axiosError(config, { status: 401, code: 'INVALID_SESSION' })
    }

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().status).toBe('unauthenticated')
    expect(useAuthStore.getState().user).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('stays unavailable on network failure instead of logging out', async () => {
    rawClient.defaults.adapter = async (config) => {
      throw axiosError(config, { network: true })
    }

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().status).toBe('unavailable')
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('does not treat a 5xx refresh failure as logout', async () => {
    rawClient.defaults.adapter = async (config) => {
      throw axiosError(config, { status: 503, code: 'UNAVAILABLE', message: 'down' })
    }

    await useAuthStore.getState().restoreSession()

    expect(useAuthStore.getState().status).toBe('unavailable')
  })

  it('hydrates from login and clears on logout', async () => {
    apiClient.defaults.adapter = async (config) => {
      if (String(config.url).includes('/auth/login')) return jsonResponse(config, refreshPayload)
      if (String(config.url).includes('/auth/logout')) return jsonResponse(config, { success: true })
      throw axiosError(config, { status: 404, code: 'NOT_FOUND' })
    }

    await useAuthStore.getState().login({ username: 'ada', password: 'secret' })
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(useAuthStore.getState().user.username).toBe('ada')

    await useAuthStore.getState().logout()
    expect(useAuthStore.getState().status).toBe('unauthenticated')
    expect(getAccessToken()).toBeNull()
  })

  it('uses the public login OTP endpoint, never the authenticated phone-change endpoint', async () => {
    apiClient.defaults.adapter = async (config) => {
      expect(config.url).toBe('/api/v1/auth/otp/request')
      expect(JSON.parse(config.data)).toEqual({ phone: '+919876543210' })
      return jsonResponse(config, { accepted: true, retryAfterSeconds: 60, expiresInSeconds: 60 })
    }

    await expect(useAuthStore.getState().requestOtp('+919876543210')).resolves.toMatchObject({
      accepted: true,
    })
  })
})
