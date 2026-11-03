const MEMORY = new Map()
const STORAGE_PREFIX = 'company-chat.transfers.'
export const MULTIPART_CONCURRENCY = 3

export function fileFingerprint(file) {
  return {
    fileName: file?.name || '',
    size: Number(file?.size || 0),
    lastModified: Number(file?.lastModified || 0),
  }
}

export function fileMatchesMeta(file, meta) {
  if (!file || !meta) return false
  return (
    file.name === meta.fileName &&
    file.size === meta.size &&
    Number(file.lastModified || 0) === Number(meta.lastModified || 0)
  )
}

export function retryDelayMs(attempt, base = 400) {
  const exp = Math.min(8, attempt + 1)
  const jitter = Math.floor(Math.random() * 200)
  return base * exp + jitter
}

export function missingPartNumbers(partCount, completed = []) {
  const done = new Set(completed.map((part) => Number(part.partNumber)))
  const missing = []
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (!done.has(partNumber)) missing.push(partNumber)
  }
  return missing
}

export async function runPool(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function pump() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, pump)
  await Promise.all(workers)
  return results
}

function storageKey(conversationId) {
  return `${STORAGE_PREFIX}${conversationId}`
}

function readStored(conversationId) {
  if (typeof sessionStorage === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(storageKey(conversationId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeStored(conversationId, rows) {
  if (typeof sessionStorage === 'undefined') return
  const safe = rows.map((row) => ({
    id: row.id,
    fileName: row.fileName || row.file?.name,
    size: row.size || row.file?.size,
    lastModified: row.lastModified || row.file?.lastModified,
    attachmentId: row.attachmentId || null,
    clientMessageId: row.clientMessageId,
    parts: row.parts || [],
    phase: row.phase || 'queued',
    progress: row.progress || 0,
    error: Boolean(row.error),
    needsFile: !row.file,
  }))
  sessionStorage.setItem(storageKey(conversationId), JSON.stringify(safe))
}

export function rememberLiveFile(conversationId, id, file) {
  if (!MEMORY.has(conversationId)) MEMORY.set(conversationId, new Map())
  if (file) MEMORY.get(conversationId).set(id, file)
}

export function forgetLiveFile(conversationId, id) {
  MEMORY.get(conversationId)?.delete(id)
}

export function loadTransfers(conversationId) {
  const files = MEMORY.get(conversationId) ?? new Map()
  return readStored(conversationId).map((row) => {
    const file = files.get(row.id)
    return {
      ...row,
      file,
      needsFile: !file,
      error: Boolean(row.error) || !file,
    }
  })
}

export function saveTransfers(conversationId, rows) {
  for (const row of rows) {
    if (row.file) rememberLiveFile(conversationId, row.id, row.file)
  }
  writeStored(conversationId, rows)
}

export function clearTransfer(conversationId, id) {
  forgetLiveFile(conversationId, id)
  writeStored(
    conversationId,
    readStored(conversationId).filter((row) => row.id !== id),
  )
}
