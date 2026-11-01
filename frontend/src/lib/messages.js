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

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export function isExpiredMessage(message) {
  return Boolean(message?.expiredAt)
}

export function visibleMessages(messages) {
  return (messages ?? []).filter((message) => !isExpiredMessage(message))
}

export function canMutateMessage(message, currentUserId, now = Date.now()) {
  if (!message || message.pending || message.deletedAt || message.expiredAt) return false
  if (message.senderId !== currentUserId) return false
  if (message.messageType === 'system') return false
  return now - new Date(message.createdAt).getTime() <= 15 * 60 * 1000
}

export function canDeleteForMe(message) {
  return Boolean(message) && !message.pending && !message.expiredAt && message.messageType !== 'system'
}

export function canDeleteForEveryone(message, { currentUserId, conversationType, now = Date.now() } = {}) {
  return conversationType === 'direct' && canMutateMessage(message, currentUserId, now)
}

export function canCopyMessage(message) {
  return Boolean(message?.content) && !message.pending && !message.deletedAt && !message.expiredAt && message.messageType !== 'system'
}

export function canReactToMessage(message) {
  return Boolean(message) && !message.pending && !message.deletedAt && !message.expiredAt && message.messageType !== 'system'
}

export function canReplyToMessage(message) {
  return Boolean(message) && !message.pending && !message.deletedAt && !message.expiredAt && message.messageType !== 'system'
}

export function canForwardMessage(message) {
  return canReplyToMessage(message)
}

export function canDownloadMessage(message) {
  return Boolean(
    message?.attachment?.id &&
      message.attachment.status === 'available' &&
      !message.pending &&
      !message.deletedAt &&
      !message.expiredAt,
  )
}

export function canReplyPrivately(message, { currentUserId, isGroup } = {}) {
  return Boolean(
    isGroup &&
      canReplyToMessage(message) &&
      message.senderId &&
      message.senderId !== currentUserId,
  )
}

export function hasReacted(reaction, currentUserId) {
  return Boolean(currentUserId && reaction?.userIds?.includes(currentUserId))
}

export function removeMessage(messages, id) {
  return (messages ?? []).filter((message) => message.id !== id)
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
