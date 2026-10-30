import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'
import { upsertMessage } from '@/lib/messages'

export function patchConversationList(updater) {
  queryClient.setQueryData(queryKeys.conversations, (current) => {
    if (!current?.data) return current
    return { ...current, data: updater(current.data) }
  })
}

export function applyRealtimeEvent(event, { currentUserId, onTyping, onPresence, onRevoked } = {}) {
  if (!event?.event) return
  const data = event.data ?? {}

  if (event.event === 'session.revoked') {
    onRevoked?.()
    return
  }

  if (event.event === 'presence.updated') {
    onPresence?.(data.userId, data.online === true)
    return
  }

  if (event.event === 'typing.updated') {
    onTyping?.(data.conversationId, data.userId, data.typing === true)
    return
  }

  if (event.event === 'conversation.created' || event.event === 'conversation.updated') {
    queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
    if (data.id) queryClient.invalidateQueries({ queryKey: queryKeys.conversation(data.id) })
    return
  }

  if (event.event === 'message.created' || event.event === 'message.updated' || event.event === 'message.deleted') {
    const conversationId = data.conversationId
    if (!conversationId) return
    queryClient.setQueryData(queryKeys.messages(conversationId), (current) => {
      const list = current?.data ?? []
      return { ...current, data: upsertMessage(list, data) }
    })
    patchConversationList((rows) =>
      rows.map((row) => {
        if (row.id !== conversationId) return row
        const unread =
          data.senderId && data.senderId !== currentUserId && event.event === 'message.created'
            ? (row.unreadCount ?? 0) + 1
            : row.unreadCount
        return {
          ...row,
          latestMessage: event.event === 'message.created' ? data : row.latestMessage?.id === data.id ? { ...row.latestMessage, ...data } : row.latestMessage,
          unreadCount: unread,
          lastMessageSeq: data.sequenceNumber ?? row.lastMessageSeq,
          lastChangeSeq: data.changeSeq ?? row.lastChangeSeq,
          updatedAt: data.createdAt || row.updatedAt,
        }
      }),
    )
    return
  }

  if (event.event === 'receipt.updated') {
    if (data.conversationId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts(data.conversationId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(data.conversationId) })
    }
    if (data.userId === currentUserId && Number.isInteger(data.sequenceNumber)) {
      patchConversationList((rows) =>
        rows.map((row) =>
          data.conversationId && row.id !== data.conversationId
            ? row
            : { ...row, unreadCount: 0 },
        ),
      )
    }
    return
  }

  if (
    event.event === 'group.member_added' ||
    event.event === 'group.member_removed' ||
    event.event === 'group.member_updated' ||
    event.event === 'group.member_left' ||
    event.event === 'group.owner_transferred'
  ) {
    const conversationId = data.conversationId
    if (conversationId && event.event === 'group.member_updated' && data.userId && data.role) {
      queryClient.setQueryData(queryKeys.conversation(conversationId), (current) => {
        if (!current?.members) return current
        return {
          ...current,
          members: current.members.map((member) =>
            member.id === data.userId ? { ...member, role: data.role } : member,
          ),
        }
      })
    }
    if (conversationId && event.event === 'group.owner_transferred' && data.userId) {
      queryClient.setQueryData(queryKeys.conversation(conversationId), (current) => {
        if (!current?.members) return current
        return {
          ...current,
          members: current.members.map((member) => {
            if (member.id === data.userId) return { ...member, role: 'owner' }
            if (member.role === 'owner') return { ...member, role: 'admin' }
            return member
          }),
        }
      })
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
    queryClient.invalidateQueries({ queryKey: queryKeys.groups })
    queryClient.invalidateQueries({ queryKey: ['conversation'] })
    queryClient.invalidateQueries({ queryKey: ['group'] })
    queryClient.invalidateQueries({ queryKey: ['messages'] })
  }
}
