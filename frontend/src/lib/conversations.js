export function conversationPeer(conversation, currentUserId) {
  return conversation?.members?.find((member) => member.id !== currentUserId) ?? null
}

export function conversationTitle(conversation, currentUserId) {
  if (!conversation) return 'Conversation'
  if (conversation.type === 'group') return conversation.title?.trim() || 'Group'
  return conversationPeer(conversation, currentUserId)?.displayName || 'Direct message'
}

export function conversationSubtitle(conversation, currentUserId) {
  if (conversation?.type === 'group') {
    const count = conversation.members?.length ?? 0
    return `${count} member${count === 1 ? '' : 's'}`
  }
  const peer = conversationPeer(conversation, currentUserId)
  return peer ? `@${peer.username}` : 'Private chat'
}

export function previewText(message) {
  if (!message) return 'No messages yet'
  if (message.deletedAt) return 'Message deleted'
  if (message.messageType === 'system') return message.content
  if (message.messageType === 'image') return message.content || 'Photo'
  if (message.messageType === 'video') return message.content || 'Video'
  if (message.messageType === 'audio') return message.content || 'Audio'
  if (message.messageType === 'file') return message.content || message.attachment?.originalName || 'File'
  return message.content
}

export function conversationActivityAt(conversation) {
  const raw = conversation?.latestMessage?.createdAt || conversation?.updatedAt
  const time = Date.parse(raw || '')
  return Number.isFinite(time) ? time : 0
}

export function sortConversationsByActivity(conversations) {
  return [...(conversations ?? [])].sort((left, right) => {
    const delta = conversationActivityAt(right) - conversationActivityAt(left)
    if (delta !== 0) return delta
    return String(right.id ?? '').localeCompare(String(left.id ?? ''))
  })
}

export function sameConversationMessage(left, right) {
  if (!left || !right) return false
  if (left.id && right.id && left.id === right.id) return true
  return Boolean(left.clientMessageId && right.clientMessageId && left.clientMessageId === right.clientMessageId)
}

export function applyConversationMessage(
  rows,
  conversationId,
  message,
  { event = 'message.created', currentUserId, viewedConversationId = null } = {},
) {
  if (!conversationId) return rows ?? []
  const list = Array.isArray(rows) ? rows : []
  const index = list.findIndex((row) => row.id === conversationId)
  const current = index >= 0 ? list[index] : { id: conversationId, unreadCount: 0 }
  const created = event === 'message.created'
  const duplicate = sameConversationMessage(current.latestMessage, message)
  const staleSequence =
    Number.isInteger(message?.sequenceNumber) &&
    Number.isInteger(current.lastMessageSeq) &&
    message.sequenceNumber <= current.lastMessageSeq
  const incoming =
    created &&
    Boolean(message?.senderId) &&
    message.senderId !== currentUserId &&
    !duplicate &&
    !staleSequence
  const viewing = Boolean(viewedConversationId && viewedConversationId === conversationId)
  const unreadCount = viewing ? 0 : incoming ? (current.unreadCount ?? 0) + 1 : (current.unreadCount ?? 0)

  let latestMessage = current.latestMessage ?? null
  if (created) {
    latestMessage = duplicate && current.latestMessage ? { ...current.latestMessage, ...message } : message
  } else if (latestMessage && sameConversationMessage(latestMessage, message)) {
    latestMessage =
      event === 'message.deleted' || message?.deletedAt || message?.hidden
        ? {
            ...latestMessage,
            ...message,
            content: '',
            deletedAt: message?.deletedAt || latestMessage.deletedAt || new Date().toISOString(),
          }
        : { ...latestMessage, ...message }
  }

  const nextRow = {
    ...current,
    latestMessage,
    unreadCount,
    lastMessageSeq: Number.isInteger(message?.sequenceNumber)
      ? Math.max(current.lastMessageSeq ?? 0, message.sequenceNumber)
      : current.lastMessageSeq,
    lastChangeSeq: message?.changeSeq ?? current.lastChangeSeq,
    updatedAt: created ? message?.createdAt || message?.updatedAt || current.updatedAt : current.updatedAt,
  }

  const bump = created && !staleSequence

  if (index === -1) {
    return bump ? [nextRow, ...list] : list
  }

  if (
    index === 0 &&
    current.unreadCount === unreadCount &&
    current.lastMessageSeq === nextRow.lastMessageSeq &&
    sameConversationMessage(current.latestMessage, latestMessage) &&
    current.latestMessage?.content === latestMessage?.content
  ) {
    return list
  }

  if (!bump || index === 0) {
    const next = list.slice()
    next[index] = nextRow
    return next
  }

  return [nextRow, ...list.slice(0, index), ...list.slice(index + 1)]
}

export function filterConversations(conversations, { query = '', filter = 'all', currentUserId } = {}) {
  const needle = query.trim().toLowerCase()
  const filtered = (conversations ?? []).filter((conversation) => {
    if (filter === 'unread' && !(conversation.unreadCount > 0)) return false
    if (filter === 'groups' && conversation.type !== 'group') return false
    if (!needle) return true
    const title = conversationTitle(conversation, currentUserId).toLowerCase()
    const preview = previewText(conversation.latestMessage).toLowerCase()
    return title.includes(needle) || preview.includes(needle)
  })
  return sortConversationsByActivity(filtered)
}
