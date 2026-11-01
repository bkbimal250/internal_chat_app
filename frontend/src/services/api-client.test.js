import { AxiosError } from 'axios'
import { afterEach, describe, expect, it } from 'vitest'
import { apiClient, rawClient, refreshAccessToken } from '@/services/api-client'
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
})
