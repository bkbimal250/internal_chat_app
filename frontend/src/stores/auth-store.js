import { create } from 'zustand'
import { apiClient, isAuthFailure, refreshAccessToken } from '@/services/api-client'
import { applyTokens, clearTokens, getCsrfToken, subscribeSession } from '@/services/session-tokens'
import { getDeviceName } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'

const emptySession = {
  user: null,
  accessToken: null,
  csrfToken: null,
  sessionId: null,
  deviceId: null,
  expiresAt: null,
}

let restorePromise = null

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
    useUiStore.getState().resetWorkspace()
  },

  async restoreSession() {
    if (get().status === 'authenticated') return
    if (restorePromise) return restorePromise

    restorePromise = (async () => {
      set({ status: 'loading' })
      if (!getCsrfToken()) {
        get().reset()
        return
      }
      try {
        const payload = await refreshAccessToken()
        get().hydrate(payload)
        try {
          const { data } = await apiClient.get('/api/v1/auth/me')
          if (data) set({ user: data })
        } catch (error) {
          if (isAuthFailure(error)) get().reset()
        }
      } catch (error) {
        if (isAuthFailure(error) || !getCsrfToken()) {
          get().reset()
          return
        }
        set({ status: 'unavailable' })
      }
    })().finally(() => {
      restorePromise = null
    })

    return restorePromise
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

  async requestOtp(phone) {
    const { data } = await apiClient.post('/api/v1/auth/otp/request', { phone })
    return data
  },

  async loginWithOtp({ phone, code }) {
    const { data } = await apiClient.post('/api/v1/auth/otp/verify', {
      phone,
      code,
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

subscribeSession((event, detail) => {
  const state = useAuthStore.getState()
  if (event === 'cleared' && state.status === 'authenticated') {
    useAuthStore.setState({ status: 'anonymous', ...emptySession })
  }
  if (event === 'refreshed' && state.status === 'authenticated' && detail) {
    state.hydrate(detail)
  }
})
