import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/services/api-client'
import { useFeaturesStore } from '@/stores/features-store'

vi.mock('@/services/api-client', () => ({
  apiClient: { get: vi.fn() },
}))

describe('features store', () => {
  beforeEach(() => {
    useFeaturesStore.getState().reset()
    apiClient.get.mockReset()
  })

  afterEach(() => {
    useFeaturesStore.getState().reset()
  })

  it('defaults both features off', () => {
    expect(useFeaturesStore.getState().attachmentsEnabled).toBe(false)
    expect(useFeaturesStore.getState().callsEnabled).toBe(false)
  })

  it('loads flags from health/ready', async () => {
    apiClient.get.mockResolvedValue({
      data: { attachmentsEnabled: true, callsEnabled: true },
    })
    await useFeaturesStore.getState().load()
    expect(apiClient.get).toHaveBeenCalledWith('/health/ready')
    expect(useFeaturesStore.getState().attachmentsEnabled).toBe(true)
    expect(useFeaturesStore.getState().callsEnabled).toBe(true)
  })

  it('stays disabled when health/ready is unavailable', async () => {
    apiClient.get.mockRejectedValue(new Error('offline'))
    await useFeaturesStore.getState().load()
    expect(useFeaturesStore.getState().attachmentsEnabled).toBe(false)
    expect(useFeaturesStore.getState().callsEnabled).toBe(false)
    expect(useFeaturesStore.getState().loaded).toBe(true)
  })
})
