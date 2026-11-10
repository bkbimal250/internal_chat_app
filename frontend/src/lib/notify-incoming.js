const seenMessageIds = new Set()
const MAX_SEEN = 500

export function documentIsActive({
  visibilityState = typeof document === 'undefined' ? 'visible' : document.visibilityState,
  hasFocus = typeof document === 'undefined' ? true : typeof document.hasFocus === 'function' ? document.hasFocus() : true,
} = {}) {
  return visibilityState === 'visible' && hasFocus === true
}

export function viewedConversationForNotifications(activeConversationId, activity = {}) {
  return documentIsActive(activity) ? activeConversationId || null : null
}

export function rememberMessageId(messageId, seen = seenMessageIds) {
  if (!messageId) return true
  if (seen.has(messageId)) return false
  seen.add(messageId)
  if (seen.size > MAX_SEEN) {
    const first = seen.values().next().value
    seen.delete(first)
  }
  return true
}

export function shouldNotifyIncomingMessage({
  message,
  currentUserId,
  viewedConversationId = null,
  documentVisible = true,
  documentFocused = true,
  seen = seenMessageIds,
} = {}) {
  if (!message?.id || !message.senderId || !message.conversationId) return false
  if (message.senderId === currentUserId) return false
  if (!rememberMessageId(message.id, seen)) return false
  const activelyViewing =
    Boolean(viewedConversationId) &&
    viewedConversationId === message.conversationId &&
    documentVisible &&
    documentFocused
  return !activelyViewing
}

export function resetSeenMessageIds(seen = seenMessageIds) {
  seen.clear()
}
