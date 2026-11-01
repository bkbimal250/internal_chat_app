import { attachmentsApi } from '@/services/api'
import { MULTIPART_PART_SIZE, SINGLE_PUT_MAX_BYTES, planUpload } from './media-limits'
import { prepareOutgoingFile } from './media-compress'

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
    signal?.addEventListener('abort', () => request.abort())
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

async function putWithRetry(url, body, headers, options, attempts = 3) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await putSlice(url, body, headers, options)
    } catch (error) {
      lastError = error
      if (error.cancelled || options.signal?.aborted) throw error
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  throw lastError
}

async function uploadMultipart(init, file, { onProgress, signal, completed = [] }) {
  const startedAt = Date.now()
  const done = [...completed]
  const startPart = done.length + 1
  const startOffset = (startPart - 1) * MULTIPART_PART_SIZE
  for (let start = startOffset; start < file.size; start += MULTIPART_PART_SIZE) {
    if (signal?.aborted) throw uploadError('Upload cancelled', { cancelled: true })
    const partNumber = done.length + 1
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
    done.push({ partNumber, etag })
    emitProgress(onProgress, end, file.size, startedAt)
  }
  return done
}

export async function uploadAttachment({
  conversationId,
  file,
  caption,
  replyToMessageId,
  quality = 'auto',
  onProgress,
  signal,
}) {
  const prepared = await prepareOutgoingFile(file, { quality, onProgress, signal })
  const outgoing = prepared.file
  const init = await attachmentsApi.init(conversationId, {
    fileName: outgoing.name,
    mimeType: outgoing.type || 'application/octet-stream',
    sizeBytes: outgoing.size,
    strategy: outgoing.size > SINGLE_PUT_MAX_BYTES ? 'multipart' : undefined,
  })
  try {
    const startedAt = Date.now()
    let parts
    if (init.mode === 'multipart' || planUpload(outgoing.size).mode === 'multipart') {
      parts = await uploadMultipart(init, outgoing, { onProgress, signal })
    } else {
      await putWithRetry(init.uploadUrl, outgoing, init.headers, {
        onProgress,
        signal,
        startedAt,
        offset: 0,
        total: outgoing.size,
      })
    }
    onProgress?.({ phase: 'finalizing', percent: 100, sent: outgoing.size, total: outgoing.size })
    const message = await attachmentsApi.finalize(init.id, {
      clientMessageId: crypto.randomUUID(),
      caption,
      replyToMessageId,
      ...(parts ? { parts } : {}),
    })
    return { ...message, uploadMeta: { originalSize: prepared.originalSize, compressed: prepared.compressed } }
  } catch (error) {
    await attachmentsApi.remove(init.id).catch(() => {})
    throw error
  }
}
