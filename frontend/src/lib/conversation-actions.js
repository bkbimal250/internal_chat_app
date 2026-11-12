import { isArchived, isMuted, isPinned } from '@/lib/conversations'

export { isArchived, isMuted, isPinned }

export const MAX_PINNED = 3
export const HIDE_CHATS_BODY =
  'This removes the chat from your list only. Other people keep it, and you stay in any group. ' +
  'A new message can make the chat appear again. Older messages stay hidden for you.'

export function hideChatsTitle(count) {
  return count === 1 ? 'Delete this chat?' : `Delete ${count} chats?`
}

export function conversationSeq(row) {
  if (Number.isInteger(row?.lastMessageSeq)) return row.lastMessageSeq
  const seq = row?.latestMessage?.sequenceNumber
  return Number.isInteger(seq) ? seq : 0
}

export function selectionSnapshot(rows = []) {
  return {
    count: rows.length,
    ids: rows.map((row) => row.id).filter(Boolean),
    allPinned: rows.length > 0 && rows.every(isPinned),
    anyPinned: rows.some(isPinned),
    allMuted: rows.length > 0 && rows.every(isMuted),
    anyMuted: rows.some(isMuted),
    allArchived: rows.length > 0 && rows.every(isArchived),
    anyArchived: rows.some(isArchived),
    anyUnread: rows.some((row) => (row.unreadCount ?? 0) > 0),
    anyRead: rows.some((row) => (row.unreadCount ?? 0) <= 0),
  }
}

export function parseBulkResult(body, { requested = [], key } = {}) {
  if (body?.id) {
    return { updated: [body], failed: [] }
  }
  const updated = []
  for (const row of body?.[key] ?? []) {
    if (typeof row === 'string') {
      updated.push({ id: row })
      continue
    }
    const id = row?.id || row?.conversationId
    if (id) updated.push({ id, ...row })
  }
  const failed = []
  for (const row of body?.failed ?? []) {
    if (!row?.id) continue
    failed.push({ id: row.id, code: row.code, message: row.message })
  }
  if (!updated.length && !failed.length && requested.length) {
    return {
      updated: [],
      failed: requested.map((id) => ({ id, message: "Couldn't update the selected chats. Try again." })),
    }
  }
  return { updated, failed }
}

export function bulkErrorMessage(result, action) {
  const failed = result?.failed ?? []
  const updated = result?.updated ?? []
  if (!failed.length) return ''
  if (!updated.length) {
    return failed.length === 1
      ? failed[0].message || `Couldn't ${action} that chat. Try again.`
      : `Couldn't ${action} the selected chats. Try again.`
  }
  const suffix = action.endsWith('e') ? 'd' : 'ed'
  return `Updated ${updated.length} chat${updated.length === 1 ? '' : 's'}. ${failed.length} could not be ${action}${suffix}.`
}

export function applyHideToList(current, previous, result) {
  const failed = new Set((result.failed ?? []).map((row) => row.id))
  const hiddenUntil = Object.fromEntries(
    (result.updated ?? []).map((row) => [row.id, row.hiddenUntilSeq ?? conversationSeq(row)]),
  )
  const kept = new Map()
  for (const row of current ?? []) {
    if (!row?.id) continue
    const until = hiddenUntil[row.id]
    if (until != null && conversationSeq(row) <= until) continue
    kept.set(row.id, row)
  }
  for (const row of previous ?? []) {
    if (row?.id && failed.has(row.id)) kept.set(row.id, row)
  }
  return [...kept.values()]
}

export function applyUpdatesToList(current, previous, result, merge, keep = () => true) {
  const failed = new Set((result.failed ?? []).map((row) => row.id))
  const updates = Object.fromEntries((result.updated ?? []).map((row) => [row.id, row]))
  const kept = new Map()
  for (const row of current ?? []) {
    if (!row?.id) continue
    const next = updates[row.id] ? merge(row, updates[row.id]) : row
    if (!keep(next)) continue
    kept.set(row.id, next)
  }
  for (const row of previous ?? []) {
    if (row?.id && failed.has(row.id)) kept.set(row.id, row)
  }
  for (const [id, update] of Object.entries(updates)) {
    if (kept.has(id) || failed.has(id)) continue
    const previousRow = (previous ?? []).find((row) => row.id === id) ?? { id }
    const next = merge(previousRow, update)
    if (keep(next)) kept.set(id, next)
  }
  return [...kept.values()]
}

export function mergePin(row, update) {
  return {
    ...row,
    pinnedAt: update.pinnedAt ?? null,
    archivedAt: update.archivedAt ?? null,
    pinned: update.pinned ?? Boolean(update.pinnedAt),
  }
}

export function mergeArchive(row, update) {
  return {
    ...row,
    archivedAt: update.archivedAt ?? null,
    pinnedAt: update.pinnedAt ?? null,
    archived: update.archived ?? Boolean(update.archivedAt),
  }
}

export function mergeMute(row, update) {
  return {
    ...row,
    mutedUntil: update.mutedUntil ?? null,
  }
}

export function mergeRead(row, update) {
  return {
    ...row,
    unreadCount: 0,
    lastReadSeq: update.lastReadSeq ?? row.lastReadSeq,
  }
}

export function mergeUnread(row, update) {
  const last = conversationSeq({ ...row, ...update })
  const floor = row.hiddenUntilSeq ?? 0
  const lastReadSeq = update.lastReadSeq ?? (last > floor ? last - 1 : floor)
  return {
    ...row,
    lastReadSeq,
    unreadCount: Math.max(1, last - lastReadSeq),
  }
}

export function findConversation(lists, id) {
  for (const rows of lists) {
    const match = rows?.find((row) => row.id === id)
    if (match) return match
  }
  return null
}
