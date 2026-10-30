import { create } from 'zustand'
import { apiClient, refreshAccessToken } from '@/services/api-client'
import { applyTokens, clearTokens, getCsrfToken, subscribeSession } from '@/services/session-tokens'
import { getDeviceName } from '@/lib/utils'

const emptySession = {
  user: null,
  accessToken: null,
  csrfToken: null,
  sessionId: null,
  deviceId: null,
  expiresAt: null,
}

export const useAuthStore = create((set, get) => ({
  status: 'idle',
  ...emptySession,

  hydrate(payload) {
    applyTokens({
      accessToken: payload.accessToken,
      csrfToken: payload.csrfToken,
    })
    set({
      status: 'authenticated',
      user: payload.user ?? get().user,
      accessToken: payload.accessToken,
      csrfToken: payload.csrfToken ?? getCsrfToken(),
      sessionId: payload.sessionId ?? get().sessionId,
      deviceId: payload.deviceId ?? get().deviceId,
      expiresAt: Date.now() + (payload.expiresIn ?? 900) * 1000,
    })
  },

  reset() {
    clearTokens()
    set({ status: 'anonymous', ...emptySession })
  },

  async restoreSession() {
    if (get().status === 'loading') return
    set({ status: 'loading' })
    if (!getCsrfToken()) {
      get().reset()
      return
    }
    try {
      const payload = await refreshAccessToken()
      get().hydrate(payload)
    } catch {
      get().reset()
    }
  },

  async login({ username, password }) {
    const { data } = await apiClient.post('/api/v1/auth/login', {
      username,
      password,
      clientType: 'web',
      platform: 'web',
      deviceName: getDeviceName(),
    })
    get().hydrate(data)
    return data
  },

  async logout() {
    try {
      if (get().accessToken) {
        await apiClient.post('/api/v1/auth/logout')
      }
    } finally {
      get().reset()
    }
  },

  async changePassword(values) {
    await apiClient.post('/api/v1/auth/change-password', values)
    get().reset()
  },
}))

subscribeSession((event) => {
  if (event === 'cleared' && useAuthStore.getState().status === 'authenticated') {
    useAuthStore.setState({ status: 'anonymous', ...emptySession })
  }
})
