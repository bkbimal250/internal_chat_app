import { attachmentsApi } from '@/services/api'
import { MULTIPART_PART_SIZE, SINGLE_PUT_MAX_BYTES, planUpload } from './media-limits'
import { prepareOutgoingFile } from './media-compress'
import {
  MULTIPART_CONCURRENCY,
  missingPartNumbers,
  retryDelayMs,
  runPool,
} from './transfer-runtime'

export { ATTACHMENT_ACCEPT } from './media-limits'

function uploadError(message, extra = {}) {
  return Object.assign(new Error(message), extra)
}

function emitProgress(onProgress, sent, total, startedAt, phase = 'uploading') {
  const elapsed = (Date.now() - startedAt) / 1000
  const rate = elapsed > 0 ? sent / elapsed : 0
  const remaining = rate > 0 ? (total - sent) / rate : 0
  onProgress?.({
    phase,
    percent: total ? Math.min(100, Math.round((sent / total) * 100)) : 0,
    sent,
    total,
    etaSeconds: remaining,
  })
}

function putSlice(url, body, headers, { onProgress, signal, startedAt, offset, total }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    Object.entries(headers ?? {}).forEach(([key, value]) => request.setRequestHeader(key, value))
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      emitProgress(onProgress, offset + event.loaded, total, startedAt)
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.getResponseHeader('ETag') || request.getResponseHeader('etag'))
        return
      }
      reject(uploadError('Upload failed'))
    }
    request.onerror = () => reject(uploadError('Upload failed'))
    request.onabort = () => reject(uploadError('Upload cancelled', { cancelled: true }))
    if (signal?.aborted) {
      reject(uploadError('Upload cancelled', { cancelled: true }))
      return
    }
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    request.send(body)
  })
}

export function putWithProgress(url, file, headers, { onProgress, signal } = {}) {
  const startedAt = Date.now()
  return putSlice(url, file, headers, {
    onProgress: (event) => onProgress?.(event.percent ?? 0),
    signal,
    startedAt,
    offset: 0,
    total: file.size,
  })
}

async function putWithRetry(url, body, headers, options, attempts = 4) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await putSlice(url, body, headers, options)
    } catch (error) {
      lastError = error
      if (error.cancelled || options.signal?.aborted) throw error
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)))
    }
  }
  throw lastError
}

async function uploadMultipart(init, file, { onProgress, signal, completed = [], onState }) {
  const startedAt = Date.now()
  const plan = planUpload(file.size)
  const done = new Map(completed.map((part) => [Number(part.partNumber), part]))
  const listed = await attachmentsApi.parts(init.id).catch(() => ({ parts: [] }))
  for (const part of listed.parts ?? []) {
    if (part.partNumber && part.etag) {
      done.set(Number(part.partNumber), { partNumber: Number(part.partNumber), etag: part.etag })
    }
  }
  const pending = missingPartNumbers(plan.partCount, [...done.values()])
  emitProgress(onProgress, done.size * MULTIPART_PART_SIZE, file.size, startedAt)
  const uploadPart = async (partNumber) => {
    if (signal?.aborted) throw uploadError('Upload cancelled', { cancelled: true })
    const start = (partNumber - 1) * MULTIPART_PART_SIZE
    const end = Math.min(file.size, start + MULTIPART_PART_SIZE)
    const signed = await attachmentsApi.signParts(init.id, { partNumbers: [partNumber] })
    const part = signed.parts[0]
    const etag = await putWithRetry(part.uploadUrl, file.slice(start, end), part.headers, {
      onProgress,
      signal,
      startedAt,
      offset: start,
      total: file.size,
    })
    if (!etag) throw uploadError('Upload failed')
    const row = { partNumber, etag }
    done.set(partNumber, row)
    onState?.({ parts: [...done.values()].sort((a, b) => a.partNumber - b.partNumber) })
    emitProgress(onProgress, Math.min(file.size, done.size * MULTIPART_PART_SIZE), file.size, startedAt)
    return row
  }
  await runPool(pending, MULTIPART_CONCURRENCY, uploadPart)
  return [...done.values()].sort((a, b) => a.partNumber - b.partNumber)
}

async function finalizeWithRetry(id, body, signal) {
  let lastError
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal?.aborted) throw uploadError('Upload cancelled', { cancelled: true })
    try {
      return await attachmentsApi.finalize(id, body)
    } catch (error) {
      lastError = error
      const status = error?.status ?? error?.response?.status
      const code = error?.code ?? error?.response?.data?.error?.code
      if (status === 409 && (code === 'CONFLICT' || code === 'UPLOAD_INCOMPLETE')) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, 600)))
        continue
      }
      if (status === 200 || status === 201) throw error
      if (status && status < 500 && status !== 409) throw error
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, 600)))
    }
  }
  throw lastError
}

export async function uploadAttachment({
  conversationId,
  file,
  caption,
  replyToMessageId,
  quality = 'auto',
  onProgress,
  signal,
  clientMessageId = crypto.randomUUID(),
  attachmentId,
  completedParts = [],
  onState,
}) {
  const prepared = await prepareOutgoingFile(file, { quality, onProgress, signal })
  const outgoing = prepared.file
  let init = attachmentId ? { id: attachmentId, mode: planUpload(outgoing.size).mode } : null
  if (!init) {
    init = await attachmentsApi.init(conversationId, {
      fileName: outgoing.name,
      mimeType: outgoing.type || 'application/octet-stream',
      sizeBytes: outgoing.size,
      strategy: outgoing.size > SINGLE_PUT_MAX_BYTES ? 'multipart' : undefined,
    })
    onState?.({ attachmentId: init.id, clientMessageId, phase: 'uploading' })
  }
  try {
    const startedAt = Date.now()
    let parts
    if (init.mode === 'multipart' || planUpload(outgoing.size).mode === 'multipart') {
      parts = await uploadMultipart(init, outgoing, {
        onProgress,
        signal,
        completed: completedParts,
        onState: (state) => onState?.({ attachmentId: init.id, clientMessageId, ...state }),
      })
    } else {
      const current = attachmentId ? await attachmentsApi.parts(init.id).catch(() => init) : init
      const uploadUrl = current.uploadUrl || init.uploadUrl
      if (!uploadUrl) throw uploadError('Upload failed')
      await putWithRetry(uploadUrl, outgoing, init.headers, {
        onProgress,
        signal,
        startedAt,
        offset: 0,
        total: outgoing.size,
      })
    }
    onProgress?.({ phase: 'finalizing', percent: 100, sent: outgoing.size, total: outgoing.size })
    const message = await finalizeWithRetry(
      init.id,
      {
        clientMessageId,
        caption,
        replyToMessageId,
        ...(parts ? { parts } : {}),
      },
      signal,
    )
    return { ...message, uploadMeta: { originalSize: prepared.originalSize, compressed: prepared.compressed } }
  } catch (error) {
    if (error.cancelled && init?.id) {
      await attachmentsApi.remove(init.id).catch(() => {})
    }
    error.attachmentId = init?.id
    error.clientMessageId = clientMessageId
    error.parts = completedParts
    throw error
  }
}
