import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/session-tokens', () => ({
  getAccessToken: () => 'token',
  getCsrfToken: () => 'csrf',
}))

import { downloadAttachmentsZip, MAX_BLOB_ZIP_BYTES } from '@/features/messages/download-zip'

function zipResponse({
  chunks = [new Uint8Array([80, 75, 3, 4])],
  archiveBytes = String(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)),
  archiveName = 'MiChat Files 2026-11-10 at 5.42.14 PM.zip',
} = {}) {
  let index = 0
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name) => {
        if (name === 'x-archive-name') return encodeURIComponent(archiveName)
        if (name === 'x-archive-bytes') return archiveBytes
        if (name === 'content-length') return archiveBytes
        return null
      },
    },
    body: {
      cancel: async () => {},
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined }
          const value = chunks[index]
          index += 1
          return { done: false, value }
        },
        cancel: async () => {
          index = chunks.length
        },
      }),
    },
  }
}

describe('web ZIP download', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:zip')
    URL.revokeObjectURL = vi.fn()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.showSaveFilePicker
  })

  it('posts selected ids and saves a ZIP without original filenames', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => zipResponse()),
    )
    const result = await downloadAttachmentsZip({
      conversationId: 'c1',
      ids: ['a', 'b'],
    })
    expect(result.archiveName).toBe('MiChat Files 2026-11-10 at 5.42.14 PM.zip')
    expect(result.method).toBe('blob')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/conversations/c1/attachments/zip'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['a', 'b'] }),
      }),
    )
  })

  it('refuses to buffer a ZIP larger than the blob fallback cap', async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const response = zipResponse({ archiveBytes: String(MAX_BLOB_ZIP_BYTES + 1) })
        response.body.cancel = cancel
        return response
      }),
    )
    await expect(
      downloadAttachmentsZip({ conversationId: 'c1', ids: ['a'] }),
    ).rejects.toMatchObject({ code: 'ZIP_TOO_LARGE_FOR_MEMORY' })
    expect(cancel).toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('streams to disk through the File System Access API without buffering', async () => {
    const write = vi.fn()
    const close = vi.fn()
    window.showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write, close, abort: vi.fn() }),
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => zipResponse({ archiveBytes: String(10 * 1024 * 1024 * 1024) })),
    )
    const result = await downloadAttachmentsZip({ conversationId: 'c1', ids: ['a'] })
    expect(result.method).toBe('file-picker')
    expect(write).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
