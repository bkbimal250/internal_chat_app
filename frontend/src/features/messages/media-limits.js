export const TWO_GIB = 2 * 1024 * 1024 * 1024
export const SINGLE_PUT_MAX_BYTES = 8 * 1024 * 1024
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024
export const WEB_VIDEO_COMPRESS_MAX = 80 * 1024 * 1024

export const ALLOWED_TYPES = {
  'image/jpeg': { kind: 'image', maxBytes: 25 * 1024 * 1024, compressible: true },
  'image/png': { kind: 'image', maxBytes: 25 * 1024 * 1024, compressible: true },
  'image/webp': { kind: 'image', maxBytes: 25 * 1024 * 1024, compressible: true },
  'image/gif': { kind: 'image', maxBytes: 25 * 1024 * 1024, compressible: false },
  'video/mp4': { kind: 'video', maxBytes: TWO_GIB, compressible: true },
  'video/webm': { kind: 'video', maxBytes: TWO_GIB, compressible: true },
  'video/quicktime': { kind: 'video', maxBytes: TWO_GIB, compressible: true },
  'audio/mpeg': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/mp3': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/mp4': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/x-m4a': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/m4a': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/aac': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/ogg': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/opus': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/wav': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/x-wav': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/webm': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/3gpp': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'audio/amr': { kind: 'audio', maxBytes: 100 * 1024 * 1024, compressible: false },
  'video/3gpp': { kind: 'video', maxBytes: TWO_GIB, compressible: true },
  'video/3gpp2': { kind: 'video', maxBytes: TWO_GIB, compressible: true },
  'application/pdf': { kind: 'file', maxBytes: TWO_GIB, compressible: false },
  'application/zip': { kind: 'file', maxBytes: TWO_GIB, compressible: false },
  'application/x-zip-compressed': { kind: 'file', maxBytes: TWO_GIB, compressible: false },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'file',
    maxBytes: TWO_GIB,
    compressible: false,
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'file',
    maxBytes: TWO_GIB,
    compressible: false,
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    kind: 'file',
    maxBytes: TWO_GIB,
    compressible: false,
  },
  'text/plain': { kind: 'file', maxBytes: 8 * 1024 * 1024, compressible: false },
}

const EXTENSIONS = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  '3gp': 'video/3gpp',
  amr: 'audio/amr',
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
}

export const ATTACHMENT_ACCEPT = Object.keys(ALLOWED_TYPES).join(',')

export const DOCUMENT_ACCEPT = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  '.docx',
  '.xlsx',
  '.pptx',
  'text/plain',
].join(',')

export const MEDIA_ACCEPT = 'image/*,video/*,.heic,.heif,.mov,.mp4,.webm,.3gp'

export const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.ogg,.wav,.amr,.3gp'

export const CAMERA_ACCEPT = 'image/*,video/*'

export function mimeFromName(name, fallback = '') {
  const ext = String(name || '')
    .split('.')
    .pop()
    ?.toLowerCase()
  return EXTENSIONS[ext] || fallback
}

export function specFor(file) {
  const mime = file.type && ALLOWED_TYPES[file.type] ? file.type : mimeFromName(file.name, file.type)
  return { mime, spec: ALLOWED_TYPES[mime] }
}

export function formatSize(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m left`
  return `${(seconds / 3600).toFixed(1)}h left`
}

export function planUpload(sizeBytes) {
  const multipart = sizeBytes > SINGLE_PUT_MAX_BYTES
  return {
    mode: multipart ? 'multipart' : 'single',
    partSize: MULTIPART_PART_SIZE,
    partCount: Math.ceil(sizeBytes / MULTIPART_PART_SIZE),
  }
}

export function qualityPreset(quality) {
  if (quality === 'high') return { maxEdge: 2048, imageQuality: 0.82, videoScale: 1 }
  if (quality === 'data-saver') return { maxEdge: 1280, imageQuality: 0.55, videoScale: 0.55 }
  return { maxEdge: 1600, imageQuality: 0.72, videoScale: 0.7 }
}
