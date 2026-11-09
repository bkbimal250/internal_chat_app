import { create } from 'zustand'
import { apiClient, isSessionInvalid, refreshAccessToken } from '@/services/api-client'
import { applyTokens, clearTokens, getCsrfToken, subscribeSession } from '@/services/session-tokens'
import { getDeviceName } from '@/lib/utils'
import { useUiStore } from '@/stores/ui-store'
import { useFeaturesStore } from '@/stores/features-store'

const emptySession = {
  user: null,
  accessToken: null,
  csrfToken: null,
  sessionId: null,
  deviceId: null,
  expiresAt: null,
}

let restorePromise = null
let restoreGeneration = 0

export const useAuthStore = create((set, get) => ({
  status: 'initializing',
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
    useFeaturesStore.getState().load()
  },

  reset() {
    restoreGeneration += 1
    restorePromise = null
    clearTokens()
    set({ status: 'unauthenticated', ...emptySession })
    useUiStore.getState().resetWorkspace()
    useFeaturesStore.getState().reset()
  },

  async restoreSession() {
    if (get().status === 'authenticated') return
    if (restorePromise) return restorePromise

    const generation = ++restoreGeneration
    restorePromise = (async () => {
      set({ status: 'initializing' })
      try {
        const payload = await refreshAccessToken()
        if (generation !== restoreGeneration) return
        get().hydrate(payload)
        try {
          const { data } = await apiClient.get('/api/v1/auth/me')
          if (generation !== restoreGeneration) return
          if (data) set({ user: data })
        } catch (error) {
          if (generation !== restoreGeneration) return
          if (isSessionInvalid(error)) get().reset()
        }
      } catch (error) {
        if (generation !== restoreGeneration) return
        if (isSessionInvalid(error)) {
          get().reset()
          return
        }
        set({ status: 'unavailable' })
      }
    })().finally(() => {
      if (generation === restoreGeneration) restorePromise = null
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
  if (event === 'cleared' && state.status !== 'unauthenticated') {
    useAuthStore.setState({ status: 'unauthenticated', ...emptySession })
  }
  if (event === 'refreshed' && detail?.accessToken && state.status !== 'unauthenticated') {
    state.hydrate(detail)
  }
})
