import { AxiosError } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { apiClient, isSessionInvalid, rawClient, refreshAccessToken } from '@/services/api-client'
import { applyTokens, clearTokens, getAccessToken } from '@/services/session-tokens'

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

function unauthorized(config) {
  return new AxiosError(
    'unauthorized',
    'ERR_BAD_REQUEST',
    config,
    {},
    {
      status: 401,
      statusText: 'Unauthorized',
      data: { error: { code: 'INVALID_SESSION', message: 'Invalid session', requestId: 't' } },
      headers: {},
      config,
    },
  )
}

describe('refresh coalescing', () => {
  afterEach(() => {
    rawClient.defaults.adapter = undefined
    apiClient.defaults.adapter = undefined
    clearTokens()
    if ('locks' in navigator) delete navigator.locks
  })

  it('shares one refresh request across concurrent callers', async () => {
    let calls = 0
    rawClient.defaults.adapter = async (config) => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 40))
      return jsonResponse(config, { accessToken: 'next-access', csrfToken: 'next-csrf', expiresIn: 900 })
    }

    const [first, second] = await Promise.all([refreshAccessToken(), refreshAccessToken()])
    expect(calls).toBe(1)
    expect(first.accessToken).toBe('next-access')
    expect(second.accessToken).toBe('next-access')
    expect(getAccessToken()).toBe('next-access')
  })

  it('retries concurrent 401s through a single refresh', async () => {
    applyTokens({ accessToken: 'expired', csrfToken: 'csrf' })
    let refreshCalls = 0
    rawClient.defaults.adapter = async (config) => {
      refreshCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 40))
      return jsonResponse(config, { accessToken: 'rotated', csrfToken: 'rotated-csrf', expiresIn: 900 })
    }
    apiClient.defaults.adapter = async (config) => {
      const header = config.headers?.Authorization || config.headers?.authorization
      if (header === 'Bearer rotated') return jsonResponse(config, { ok: true })
      throw unauthorized(config)
    }

    const [left, right] = await Promise.all([
      apiClient.get('/api/v1/conversations'),
      apiClient.get('/api/v1/users/me'),
    ])
    expect(refreshCalls).toBe(1)
    expect(left.data).toEqual({ ok: true })
    expect(right.data).toEqual({ ok: true })
  })

  it('refreshes even when no CSRF token is readable in JavaScript', async () => {
    document.cookie = 'chat_csrf=; max-age=0; path=/'
    expect(getAccessToken()).toBeNull()
    rawClient.defaults.adapter = async (config) => {
      expect(config.withCredentials ?? rawClient.defaults.withCredentials).toBe(true)
      return jsonResponse(config, { accessToken: 'silent', csrfToken: 'silent-csrf', expiresIn: 900 })
    }

    const payload = await refreshAccessToken()
    expect(payload.accessToken).toBe('silent')
    expect(getAccessToken()).toBe('silent')
  })

  it('does not clear tokens on a 5xx refresh failure', async () => {
    applyTokens({ accessToken: 'still-here', csrfToken: 'csrf' })
    rawClient.defaults.adapter = async (config) => {
      throw new AxiosError(
        'unavailable',
        'ERR_BAD_RESPONSE',
        config,
        {},
        { status: 503, statusText: 'Unavailable', data: { error: { code: 'UNAVAILABLE' } }, headers: {}, config },
      )
    }

    await expect(refreshAccessToken()).rejects.toMatchObject({ status: 503 })
    expect(getAccessToken()).toBe('still-here')
    expect(isSessionInvalid({ status: 503, code: 'UNAVAILABLE' })).toBe(false)
  })

  it('does not clear tokens on a network error', async () => {
    applyTokens({ accessToken: 'offline', csrfToken: 'csrf' })
    rawClient.defaults.adapter = async (config) => {
      throw new AxiosError('network', 'ERR_NETWORK', config, {}, undefined)
    }

    await expect(refreshAccessToken()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect(getAccessToken()).toBe('offline')
  })

  it('clears tokens when the refresh session is revoked', async () => {
    applyTokens({ accessToken: 'revoked', csrfToken: 'csrf' })
    rawClient.defaults.adapter = async (config) => {
      throw unauthorized(config)
    }

    await expect(refreshAccessToken()).rejects.toMatchObject({ code: 'INVALID_SESSION' })
    expect(getAccessToken()).toBeNull()
    expect(isSessionInvalid({ status: 401, code: 'INVALID_SESSION' })).toBe(true)
  })

  it('serializes tab refresh through a web lock when available', async () => {
    let active = 0
    let maxActive = 0
    let calls = 0
    const lock = {
      request: async (_name, callback) => callback(),
    }
    Object.defineProperty(navigator, 'locks', { configurable: true, value: lock })
    rawClient.defaults.adapter = async (config) => {
      calls += 1
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
      return jsonResponse(config, {
        accessToken: `lock-${calls}`,
        csrfToken: 'csrf',
        expiresIn: 900,
      })
    }

    await Promise.all([refreshAccessToken(), refreshAccessToken()])
    expect(calls).toBe(1)
    expect(maxActive).toBe(1)
  })
})
