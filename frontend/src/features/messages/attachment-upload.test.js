import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const attachmentsApi = {
  init: vi.fn(),
  signParts: vi.fn(),
  parts: vi.fn(),
  finalize: vi.fn(),
  completeBatch: vi.fn(),
  remove: vi.fn(),
}

vi.mock('@/services/api', () => ({ attachmentsApi }))
vi.mock('./media-compress', () => ({
  prepareOutgoingFile: vi.fn(async (file) => ({
    file,
    originalSize: file.size,
    compressed: false,
  })),
}))
vi.mock('./transfer-runtime', async () => {
  const actual = await vi.importActual('./transfer-runtime')
  return { ...actual, retryDelayMs: () => 0 }
})

class FakeXHR {
  static mode = 'success'
  static sent = 0

  constructor() {
    this.upload = {}
    this.status = 0
    this._headers = { etag: '"etag-1"' }
  }

  open() {}
  setRequestHeader() {}
  getResponseHeader(name) {
    return this._headers[String(name).toLowerCase()] || this._headers.etag
  }
  abort() {
    FakeXHR.mode = 'aborted'
    this.onabort?.()
  }
  send() {
    FakeXHR.sent += 1
    this.upload.onprogress?.({ lengthComputable: true, loaded: 8, total: 8 })
    if (FakeXHR.mode === 'aborted') {
      this.onabort?.()
      return
    }
    if (FakeXHR.mode === 'fail-once') {
      FakeXHR.mode = 'success'
      this.onerror?.()
      return
    }
    if (FakeXHR.mode === 'fail') {
      this.onerror?.()
      return
    }
    this.status = 200
    this.onload?.()
  }
}

describe('uploadAttachment', () => {
  beforeEach(() => {
    FakeXHR.mode = 'success'
    FakeXHR.sent = 0
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    attachmentsApi.init.mockReset()
    attachmentsApi.signParts.mockReset()
    attachmentsApi.parts.mockReset()
    attachmentsApi.finalize.mockReset()
    attachmentsApi.completeBatch.mockReset()
    attachmentsApi.remove.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads a small image through init, presigned PUT, and finalize', async () => {
    const { uploadAttachment } = await import('./attachment-upload')
    const progress = []
    attachmentsApi.init.mockResolvedValue({
      id: 'att-1',
      mode: 'single',
      uploadUrl: 'https://storage.test/put',
      headers: { 'Content-Type': 'image/png' },
    })
    attachmentsApi.finalize.mockResolvedValue({
      id: 'msg-1',
      messageType: 'image',
      attachment: { id: 'att-1', status: 'available', kind: 'image' },
    })
    const file = new File([new Uint8Array(8)], 'pixel.png', { type: 'image/png' })
    const result = await uploadAttachment({
      conversationId: 'conv-1',
      file,
      onProgress: (event) => progress.push(event),
    })
    expect(result.messageType).toBe('image')
    expect(attachmentsApi.init).toHaveBeenCalledWith('conv-1', {
      fileName: 'pixel.png',
      mimeType: 'image/png',
      sizeBytes: 8,
      strategy: undefined,
    })
    expect(attachmentsApi.finalize).toHaveBeenCalled()
    expect(progress.some((event) => (event.percent ?? event) > 0)).toBe(true)
    expect(JSON.stringify(result).includes('storage.test/put')).toBe(false)
  })

  it('retries a failed PUT then finalizes', async () => {
    const { uploadAttachment } = await import('./attachment-upload')
    FakeXHR.mode = 'fail-once'
    attachmentsApi.init.mockResolvedValue({
      id: 'att-2',
      mode: 'single',
      uploadUrl: 'https://storage.test/put',
      headers: {},
    })
    attachmentsApi.finalize.mockResolvedValue({ id: 'msg-2', attachment: { id: 'att-2' } })
    const file = new File([new Uint8Array(8)], 'pixel.png', { type: 'image/png' })
    await expect(uploadAttachment({ conversationId: 'conv-1', file })).resolves.toMatchObject({ id: 'msg-2' })
    expect(FakeXHR.sent).toBeGreaterThan(1)
  })

  it('cancels the PUT and deletes the pending attachment', async () => {
    const { uploadAttachment } = await import('./attachment-upload')
    attachmentsApi.init.mockResolvedValue({
      id: 'att-3',
      mode: 'single',
      uploadUrl: 'https://storage.test/put',
      headers: {},
    })
    attachmentsApi.remove.mockResolvedValue({ success: true })
    const controller = new AbortController()
    FakeXHR.mode = 'aborted'
    const file = new File([new Uint8Array(8)], 'pixel.png', { type: 'image/png' })
    controller.abort()
    await expect(uploadAttachment({ conversationId: 'conv-1', file, signal: controller.signal })).rejects.toMatchObject({
      cancelled: true,
    })
    expect(attachmentsApi.remove).toHaveBeenCalledWith('att-3')
    expect(attachmentsApi.finalize).not.toHaveBeenCalled()
  })

  it('uploads a multipart part then finalizes', async () => {
    const { uploadAttachment } = await import('./attachment-upload')
    attachmentsApi.init.mockResolvedValue({
      id: 'att-4',
      mode: 'multipart',
      partCount: 1,
      partSize: 8,
    })
    attachmentsApi.parts.mockResolvedValue({ parts: [] })
    attachmentsApi.signParts.mockResolvedValue({
      parts: [{ partNumber: 1, uploadUrl: 'https://storage.test/part', headers: {} }],
    })
    attachmentsApi.finalize.mockResolvedValue({ id: 'msg-4', attachment: { id: 'att-4' } })
    const file = new File([new Uint8Array(8)], 'clip.bin', { type: 'application/octet-stream' })
    await expect(uploadAttachment({ conversationId: 'conv-1', file })).resolves.toMatchObject({ id: 'msg-4' })
    expect(attachmentsApi.signParts).toHaveBeenCalledWith('att-4', { partNumbers: [1] })
    expect(attachmentsApi.finalize.mock.calls[0][1].parts).toEqual([{ partNumber: 1, etag: '"etag-1"' }])
  })

  it('surfaces a persistent PUT failure after retries', async () => {
    const { uploadAttachment } = await import('./attachment-upload')
    FakeXHR.mode = 'fail'
    attachmentsApi.init.mockResolvedValue({
      id: 'att-5',
      mode: 'single',
      uploadUrl: 'https://storage.test/put',
      headers: {},
    })
    const file = new File([new Uint8Array(8)], 'pixel.png', { type: 'image/png' })
    await expect(uploadAttachment({ conversationId: 'conv-1', file })).rejects.toThrow(/Upload failed/)
    expect(attachmentsApi.finalize).not.toHaveBeenCalled()
    expect(FakeXHR.sent).toBe(4)
  })

  it('uploads storage objects without creating a message until completeBatch', async () => {
    const { uploadToStorage, completeAttachmentBatch } = await import('./attachment-upload')
    attachmentsApi.init.mockResolvedValue({
      id: 'att-6',
      mode: 'single',
      uploadUrl: 'https://storage.test/put',
      headers: {},
    })
    attachmentsApi.completeBatch.mockResolvedValue({
      id: 'msg-batch',
      attachments: [
        { id: 'att-6', status: 'available' },
        { id: 'att-7', status: 'available' },
      ],
    })
    const file = new File([new Uint8Array(8)], 'pixel.png', { type: 'image/png' })
    const stored = await uploadToStorage({ conversationId: 'conv-1', file })
    expect(stored.init.id).toBe('att-6')
    expect(attachmentsApi.finalize).not.toHaveBeenCalled()
    const message = await completeAttachmentBatch({
      conversationId: 'conv-1',
      clientMessageId: 'client-1',
      items: [{ id: 'att-6' }, { id: 'att-7' }],
    })
    expect(message.attachments).toHaveLength(2)
    expect(attachmentsApi.completeBatch).toHaveBeenCalledWith('conv-1', {
      clientMessageId: 'client-1',
      caption: undefined,
      replyToMessageId: undefined,
      items: [{ id: 'att-6' }, { id: 'att-7' }],
    })
  })
})
