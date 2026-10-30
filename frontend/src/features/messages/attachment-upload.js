import { attachmentsApi } from '@/services/api'

const ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]

export const ATTACHMENT_ACCEPT = ACCEPT.join(',')

export function putWithProgress(url, file, headers, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', url)
    Object.entries(headers ?? {}).forEach(([key, value]) => request.setRequestHeader(key, value))
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve()
      else reject(new Error('Upload failed'))
    }
    request.onerror = () => reject(new Error('Upload failed'))
    request.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { cancelled: true }))
    signal?.addEventListener('abort', () => request.abort())
    request.send(file)
  })
}

export async function uploadAttachment({ conversationId, file, caption, replyToMessageId, onProgress, signal }) {
  const init = await attachmentsApi.init(conversationId, {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  })
  try {
    await putWithProgress(init.uploadUrl, file, init.headers, { onProgress, signal })
    return attachmentsApi.finalize(init.id, {
      clientMessageId: crypto.randomUUID(),
      caption,
      replyToMessageId,
    })
  } catch (error) {
    if (!error.cancelled) {
      await attachmentsApi.remove(init.id).catch(() => {})
    } else {
      await attachmentsApi.remove(init.id).catch(() => {})
    }
    throw error
  }
}
