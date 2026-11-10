import { formatSize, MAX_ATTACHMENT_BATCH, specFor } from './media-limits'

export { MAX_ATTACHMENT_BATCH }

export function fileIdentity(file) {
  return `${file?.name || ''}|${Number(file?.size || 0)}|${Number(file?.lastModified || 0)}`
}

export function messageAttachments(message) {
  if (Array.isArray(message?.attachments) && message.attachments.length) {
    return message.attachments.filter((file) => file && file.status !== 'deleted')
  }
  return message?.attachment ? [message.attachment] : []
}

function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function addSelectedFiles(current, incoming, { max = MAX_ATTACHMENT_BATCH } = {}) {
  const items = [...(current || [])]
  const errors = []
  const seen = new Set(items.map((item) => item.identity || fileIdentity(item.file)))
  const files = Array.from(incoming || []).filter(Boolean)

  for (const file of files) {
    const identity = fileIdentity(file)
    const { mime, spec } = specFor(file)
    if (seen.has(identity)) {
      errors.push({
        code: 'DUPLICATE',
        fileName: file.name,
        message: `${file.name} is already selected`,
      })
      continue
    }
    if (!spec) {
      errors.push({
        code: 'TYPE',
        fileName: file.name,
        message: `${file.name} is not an allowed file type`,
      })
      continue
    }
    if (file.size > spec.maxBytes) {
      errors.push({
        code: 'SIZE',
        fileName: file.name,
        message: `${file.name} is too large (${formatSize(file.size)}). Maximum is ${formatSize(spec.maxBytes)}.`,
      })
      continue
    }
    if (items.length >= max) {
      errors.push({
        code: 'BATCH',
        fileName: file.name,
        message: `You can attach up to ${max} files at once`,
      })
      continue
    }
    seen.add(identity)
    const previewable = Boolean(mime?.startsWith('image/') || mime?.startsWith('video/') || spec.kind === 'image' || spec.kind === 'video')
    items.push({
      id: nextId(),
      file,
      identity,
      mime,
      kind: spec.kind,
      status: 'queued',
      progress: 0,
      previewUrl: previewable && typeof URL !== 'undefined' ? URL.createObjectURL(file) : null,
    })
  }

  return { items, errors }
}

export function revokePreview(item) {
  if (item?.previewUrl && typeof URL !== 'undefined') {
    URL.revokeObjectURL(item.previewUrl)
  }
}

export function revokePreviews(items) {
  for (const item of items || []) revokePreview(item)
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function readMediaDuration(file) {
  if (!file || typeof document === 'undefined') return Promise.resolve(null)
  const type = file.type || ''
  if (!type.startsWith('video/') && !type.startsWith('audio/')) return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(type.startsWith('video/') ? 'video' : 'audio')
    el.preload = 'metadata'
    const done = (value) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => done(null)
    el.src = url
  })
}

export function batchProgress(items) {
  const rows = items || []
  if (!rows.length) return { sent: 0, total: 0, percent: 0, failed: 0, ready: 0 }
  const total = rows.reduce((sum, item) => sum + Number(item.file?.size || item.size || 0), 0)
  const sent = rows.reduce((sum, item) => {
    if (item.status === 'uploaded') return sum + Number(item.file?.size || item.size || 0)
    const size = Number(item.file?.size || item.size || 0)
    return sum + Math.round((size * Number(item.progress || 0)) / 100)
  }, 0)
  return {
    sent,
    total,
    percent: total ? Math.min(100, Math.round((sent / total) * 100)) : 0,
    failed: rows.filter((item) => item.status === 'failed' || item.error).length,
    ready: rows.filter((item) => item.status === 'uploaded' && item.attachmentId).length,
  }
}
