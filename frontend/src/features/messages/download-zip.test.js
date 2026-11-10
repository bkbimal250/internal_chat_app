import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/session-tokens', () => ({
  getAccessToken: () => 'token',
  getCsrfToken: () => 'csrf',
}))

import { downloadAttachmentsZip } from '@/features/messages/download-zip'

describe('web ZIP download', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:zip')
    URL.revokeObjectURL = vi.fn()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts selected ids and saves a ZIP without original filenames', async () => {
    const chunks = [new Uint8Array([80, 75, 3, 4])]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name) =>
            name === 'x-archive-name'
              ? encodeURIComponent('MiChat Files 2026-11-10 at 5.42.14 PM.zip')
              : name === 'content-length'
                ? '4'
                : null,
        },
        body: {
          getReader: () => {
            let done = false
            return {
              read: async () => {
                if (done) return { done: true, value: undefined }
                done = true
                return { done: false, value: chunks[0] }
              },
            }
          },
        },
      })),
    )
    const result = await downloadAttachmentsZip({
      conversationId: 'c1',
      ids: ['a', 'b'],
    })
    expect(result.archiveName).toBe('MiChat Files 2026-11-10 at 5.42.14 PM.zip')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/conversations/c1/attachments/zip'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['a', 'b'] }),
      }),
    )
  })
})
