import { create } from 'zustand'
import { apiClient } from '@/services/api-client'

export const useFeaturesStore = create((set) => ({
  attachmentsEnabled: false,
  callsEnabled: false,
  loaded: false,
  async load() {
    try {
      const { data } = await apiClient.get('/health/ready')
      set({
        attachmentsEnabled: data?.attachmentsEnabled === true,
        callsEnabled: data?.callsEnabled === true,
        loaded: true,
      })
    } catch {
      set({ attachmentsEnabled: false, callsEnabled: false, loaded: true })
    }
  },
  reset() {
    set({ attachmentsEnabled: false, callsEnabled: false, loaded: false })
  },
}))
