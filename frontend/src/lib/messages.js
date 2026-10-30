function seq(value) {
  return Number(value ?? 0)
}

export function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    const seqDiff = seq(a.sequenceNumber) - seq(b.sequenceNumber)
    if (seqDiff !== 0) return seqDiff
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
  })
}

export function upsertMessage(messages, incoming) {
  if (!incoming?.id) return messages ?? []
  const next = [...(messages ?? [])]
  const index = next.findIndex(
    (message) => message.id === incoming.id || (incoming.clientMessageId && message.clientMessageId === incoming.clientMessageId),
  )
  if (index === -1) {
    next.push(incoming)
  } else {
    const current = next[index]
    next[index] = {
      ...current,
      ...incoming,
      pending: incoming.pending ?? false,
      failed: incoming.failed ?? false,
    }
  }
  return sortMessages(next)
}

export function applySyncRecords(messages, records) {
  return records.reduce((list, record) => upsertMessage(list, record), messages ?? [])
}

export function oldestSequence(messages) {
  const numbered = (messages ?? []).filter((message) => Number.isFinite(seq(message.sequenceNumber)) && !message.pending)
  if (!numbered.length) return null
  return Math.min(...numbered.map((message) => seq(message.sequenceNumber)))
}

export function newestSequence(messages) {
  const numbered = (messages ?? []).filter((message) => Number.isFinite(seq(message.sequenceNumber)))
  if (!numbered.length) return 0
  return Math.max(...numbered.map((message) => seq(message.sequenceNumber)))
}

export function newestChangeSeq(messages) {
  const numbered = (messages ?? []).filter((message) => Number.isFinite(seq(message.changeSeq)))
  if (!numbered.length) return 0
  return Math.max(...numbered.map((message) => seq(message.changeSeq)))
}

export function canMutateMessage(message, currentUserId, now = Date.now()) {
  if (!message || message.pending || message.deletedAt) return false
  if (message.senderId !== currentUserId) return false
  if (message.messageType === 'system') return false
  return now - new Date(message.createdAt).getTime() <= 15 * 60 * 1000
}

export function receiptStatus(message, { currentUserId, members = [], receipts = [] } = {}) {
  if (!message || message.senderId !== currentUserId || message.pending) return 'sending'
  if (message.failed) return 'failed'
  const others = members.filter((member) => member.id !== currentUserId)
  if (!others.length) return 'sent'
  const readByLastSeq = others.some((member) => seq(member.lastReadSeq) >= seq(message.sequenceNumber))
  if (readByLastSeq) return 'read'
  const related = receipts.filter((receipt) => receipt.messageId === message.id)
  if (related.some((receipt) => receipt.readAt)) return 'read'
  if (related.some((receipt) => receipt.deliveredAt)) return 'delivered'
  return 'sent'
}
