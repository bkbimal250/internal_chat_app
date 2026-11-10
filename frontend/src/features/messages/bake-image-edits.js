import { fileIdentity } from '@/features/messages/attachment-batch'

export function hasImageEdits(edit) {
  if (!edit) return false
  const rotation = ((Number(edit.rotation) || 0) % 360 + 360) % 360
  const brightness = Number(edit.brightness)
  return rotation !== 0 || (Number.isFinite(brightness) && brightness !== 1)
}

function replaceExtension(name, extension) {
  const base = String(name || 'image').replace(/\.[^.]+$/, '')
  return `${base}.${extension}`
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read this image'))
    }
    image.src = url
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Could not save the edited image'))
        else resolve(blob)
      },
      type,
      quality,
    )
  })
}

export async function bakeImageEdits(file, edit = {}) {
  if (!file || !hasImageEdits(edit)) return file
  const rotation = ((Number(edit.rotation) || 0) % 360 + 360) % 360
  const brightness = Number.isFinite(Number(edit.brightness)) ? Number(edit.brightness) : 1
  const bitmap = await loadImageSource(file)
  const swapped = rotation === 90 || rotation === 270
  const width = swapped ? bitmap.height : bitmap.width
  const height = swapped ? bitmap.width : bitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not edit this image')
  ctx.filter = `brightness(${brightness})`
  ctx.translate(width / 2, height / 2)
  ctx.rotate((rotation * Math.PI) / 180)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  if (typeof bitmap.close === 'function') bitmap.close()
  const jpeg = file.type === 'image/jpeg' || file.type === 'image/jpg'
  const type = jpeg ? 'image/jpeg' : 'image/png'
  const blob = await canvasToBlob(canvas, type, jpeg ? 0.92 : undefined)
  return new File([blob], replaceExtension(file.name, jpeg ? 'jpg' : 'png'), {
    type,
    lastModified: Date.now(),
  })
}

export async function bakeComposerItems(items, history = {}) {
  const next = []
  for (const item of items || []) {
    const edit = history[item.id]
    if (item.kind !== 'image' || !item.file || !hasImageEdits(edit)) {
      next.push(item)
      continue
    }
    const file = await bakeImageEdits(item.file, edit)
    if (file === item.file) {
      next.push(item)
      continue
    }
    next.push({
      ...item,
      file,
      identity: fileIdentity(file),
      previewUrl: typeof URL !== 'undefined' ? URL.createObjectURL(file) : item.previewUrl,
      previousPreviewUrl: item.previewUrl,
      previousAttachmentId: item.attachmentId,
      attachmentId: undefined,
      parts: undefined,
      status: 'queued',
      progress: 0,
    })
  }
  return next
}
