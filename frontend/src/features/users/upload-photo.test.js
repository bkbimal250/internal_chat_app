import { describe, expect, it, vi } from 'vitest'
import { uploadProfilePhoto } from '@/features/users/upload-photo'

vi.mock('@/features/messages/attachment-upload', () => ({
  putWithProgress: vi.fn(async () => {}),
}))

describe('uploadProfilePhoto', () => {
  it('rejects unsupported types and oversized files', async () => {
    await expect(uploadProfilePhoto(new File(['x'], 'note.txt', { type: 'text/plain' }))).rejects.toThrow(
      /JPEG, PNG, or WebP/,
    )
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    await expect(uploadProfilePhoto(huge)).rejects.toThrow(/5 MB/)
  })

  it('uploads through init, PUT, and complete', async () => {
    const file = new File(['img'], 'me.png', { type: 'image/png' })
    const initFn = vi.fn(async () => ({
      uploadUrl: 'https://storage.test/put',
      key: 'avatars/u1/abc',
      headers: { 'Content-Type': 'image/png' },
    }))
    const completeFn = vi.fn(async () => ({ id: 'u1', hasProfilePhoto: true }))
    await expect(uploadProfilePhoto(file, initFn, completeFn)).resolves.toEqual({
      id: 'u1',
      hasProfilePhoto: true,
    })
    expect(initFn).toHaveBeenCalledWith({ mimeType: 'image/png' })
    expect(completeFn).toHaveBeenCalledWith({ key: 'avatars/u1/abc', mimeType: 'image/png' })
  })
})
