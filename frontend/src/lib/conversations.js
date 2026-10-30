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

export function filterConversations(conversations, { query = '', filter = 'all', currentUserId } = {}) {
  const needle = query.trim().toLowerCase()
  return (conversations ?? []).filter((conversation) => {
    if (filter === 'unread' && !(conversation.unreadCount > 0)) return false
    if (filter === 'groups' && conversation.type !== 'group') return false
    if (!needle) return true
    const title = conversationTitle(conversation, currentUserId).toLowerCase()
    const preview = previewText(conversation.latestMessage).toLowerCase()
    return title.includes(needle) || preview.includes(needle)
  })
}
