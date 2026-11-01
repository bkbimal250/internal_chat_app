import { qualityPreset, specFor, WEB_VIDEO_COMPRESS_MAX } from './media-limits'

function toFile(blob, name, type) {
  return new File([blob], name, { type, lastModified: Date.now() })
}

async function compressImage(file, quality) {
  if (file.type === 'image/gif') {
    return { file, compressed: false, reason: 'gif' }
  }
  try {
  const preset = qualityPreset(quality)
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, preset.maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', preset.imageQuality))
  if (!blob || blob.size >= file.size * 0.92) {
    return { file, compressed: false, reason: 'ineffective' }
  }
  return {
    file: toFile(blob, file.name.replace(/\.[^.]+$/, '.jpg'), 'image/jpeg'),
    compressed: true,
    reason: 'image',
  }
  } catch {
    return { file, compressed: false, reason: 'failed' }
  }
}

async function compressVideo(file, quality, signal) {
  if (quality === 'original' || file.size > WEB_VIDEO_COMPRESS_MAX || typeof MediaRecorder === 'undefined') {
    return { file, compressed: false, reason: file.size > WEB_VIDEO_COMPRESS_MAX ? 'too-large' : 'original' }
  }
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = url
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('Could not read that video'))
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('Upload cancelled'), { cancelled: true })))
    })
    const preset = qualityPreset(quality)
    const width = Math.max(2, Math.round((video.videoWidth || 1280) * preset.videoScale / 2) * 2)
    const height = Math.max(2, Math.round((video.videoHeight || 720) * preset.videoScale / 2) * 2)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    const stream = canvas.captureStream(30)
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm'
    const chunks = []
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: quality === 'data-saver' ? 700_000 : 1_600_000 })
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve
    })
    recorder.start(250)
    await video.play()
    const draw = () => {
      if (signal?.aborted || video.ended || video.paused) return
      context.drawImage(video, 0, 0, width, height)
      requestAnimationFrame(draw)
    }
    draw()
    await new Promise((resolve) => {
      video.onended = resolve
      signal?.addEventListener('abort', () => {
        video.pause()
        resolve()
      })
    })
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
    stream.getTracks().forEach((track) => track.stop())
    const blob = new Blob(chunks, { type: 'video/webm' })
    if (!blob.size || blob.size >= file.size * 0.92) {
      return { file, compressed: false, reason: 'ineffective' }
    }
    return {
      file: toFile(blob, file.name.replace(/\.[^.]+$/, '.webm'), 'video/webm'),
      compressed: true,
      reason: 'video',
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function prepareOutgoingFile(file, { quality = 'auto', onProgress, signal } = {}) {
  const { mime, spec } = specFor(file)
  if (!spec) throw new Error('This file type is not allowed')
  if (file.size > spec.maxBytes) {
    throw new Error(`This ${spec.kind} is larger than the ${spec.kind === 'image' ? '25 MB' : spec.maxBytes >= 1024 ** 3 ? '2 GB' : 'limit'}`)
  }
  onProgress?.({ phase: 'compressing', percent: 5 })
  if (quality === 'original' || !spec.compressible) {
    onProgress?.({ phase: 'compressing', percent: 100 })
    return { file, originalSize: file.size, compressed: false, mime: mime || file.type, kind: spec.kind }
  }
  const result =
    spec.kind === 'image'
      ? await compressImage(file, quality)
      : spec.kind === 'video'
        ? await compressVideo(file, quality, signal)
        : { file, compressed: false, reason: 'document' }
  if (result.file.size > spec.maxBytes) {
    throw new Error('This file is still too large after compression')
  }
  onProgress?.({ phase: 'compressing', percent: 100 })
  return {
    file: result.file,
    originalSize: file.size,
    compressed: result.compressed,
    reason: result.reason,
    mime: result.file.type || mime,
    kind: spec.kind,
  }
}
