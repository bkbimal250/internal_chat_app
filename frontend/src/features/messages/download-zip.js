import { appConfig } from '@/config/env'
import { getAccessToken, getCsrfToken } from '@/services/session-tokens'
import { archiveFileName } from '@/lib/michat-filename'

const MAX_ZIP_FILES = 50
export const MAX_BLOB_ZIP_BYTES = 256 * 1024 * 1024

export function assertBlobZipFits(bytes) {
  if (bytes > MAX_BLOB_ZIP_BYTES) {
    const error = new Error(
      'This ZIP is too large to download in this browser. Try Chrome or Edge, which can save the archive directly to disk.',
    )
    error.code = 'ZIP_TOO_LARGE_FOR_MEMORY'
    throw error
  }
}

function announcedArchiveBytes(headers) {
  const raw = headers.get('x-archive-bytes') || headers.get('content-length')
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function cancelBody(body) {
  try {
    body?.cancel?.()
  } catch {
    /* already closed */
  }
}

export async function downloadAttachmentsZip({
  conversationId,
  ids,
  onProgress,
  signal,
} = {}) {
  const selected = [...new Set((ids || []).filter(Boolean))]
  if (!conversationId || !selected.length) throw new Error('Select files to download')
  if (selected.length > MAX_ZIP_FILES) throw new Error(`You can download up to ${MAX_ZIP_FILES} files at once`)

  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/conversations/${conversationId}/attachments/zip`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/zip',
      'Content-Type': 'application/json',
      'X-Requested-With': appConfig.requestedWith,
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken() } : {}),
    },
    body: JSON.stringify({ ids: selected }),
    signal,
  })

  if (!response.ok) {
    let message = 'Unable to prepare the ZIP'
    try {
      const body = await response.json()
      message = body?.error?.message || message
    } catch {
      message = `Download failed (${response.status})`
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }

  const archiveName =
    decodeURIComponent(response.headers.get('x-archive-name') || '') || archiveFileName()
  const total = announcedArchiveBytes(response.headers) || Number(response.headers.get('content-length')) || 0

  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function' && response.body) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: archiveName,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      })
      const writable = await handle.createWritable()
      try {
        await writeStream(response.body, writable, { total, onProgress, signal })
        await writable.close()
      } catch (error) {
        await writable.abort().catch(() => {})
        throw error
      }
      return { archiveName, method: 'file-picker' }
    } catch (error) {
      if (error?.name === 'AbortError') throw error
    }
  }

  if (total > MAX_BLOB_ZIP_BYTES) {
    cancelBody(response.body)
    assertBlobZipFits(total)
  }

  const blob = await collectBlob(response.body, { total, onProgress, signal })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = archiveName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 1500)
  return { archiveName, method: 'blob' }
}

async function writeStream(body, writable, { total, onProgress, signal }) {
  const reader = body.getReader()
  let received = 0
  while (true) {
    if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
    const { done, value } = await reader.read()
    if (done) break
    await writable.write(value)
    received += value.byteLength
    onProgress?.({ received, total, percent: total ? Math.min(100, Math.round((received / total) * 100)) : null })
  }
}

async function collectBlob(body, { total, onProgress, signal }) {
  const reader = body.getReader()
  const chunks = []
  let received = 0
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
      if (received > MAX_BLOB_ZIP_BYTES) {
        await reader.cancel().catch(() => {})
        assertBlobZipFits(received)
      }
      onProgress?.({ received, total, percent: total ? Math.min(100, Math.round((received / total) * 100)) : null })
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  return new Blob(chunks, { type: 'application/zip' })
}
