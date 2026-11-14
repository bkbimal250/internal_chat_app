import { afterEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()

vi.mock('@/services/api-client', () => ({
  apiClient: { post },
}))

const { usersApi } = await import('@/services/api')

describe('usersApi phone verification', () => {
  afterEach(() => post.mockReset())

  it('uses the authenticated phone-change OTP endpoint', async () => {
    post.mockResolvedValue({ data: { accepted: true } })

    await expect(usersApi.requestPhoneOtp({ phone: '+919876543210' })).resolves.toEqual({
      accepted: true,
    })
    expect(post).toHaveBeenCalledWith('/api/v1/users/me/phone/otp', { phone: '+919876543210' })
  })
})
