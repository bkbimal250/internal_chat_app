import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'
import { applyConversationMessage } from '@/lib/conversations'
import { removeMessage, upsertMessage } from '@/lib/messages'
import { useAuthStore } from '@/stores/auth-store'

function patchPerson(person, data) {
  if (!person || person.id !== data.userId) return person
  return {
    ...person,
    hasProfilePhoto: data.hasProfilePhoto,
    photoVersion: data.photoVersion,
    profilePhotoUrl: data.hasProfilePhoto ? person.profilePhotoUrl : null,
    updatedAt: data.photoVersion || person.updatedAt,
  }
}

export function syncUserPhoto(updated) {
  if (!updated?.id) return
  applyUserUpdated({
    userId: updated.id,
    hasProfilePhoto: Boolean(updated.hasProfilePhoto || updated.profilePhotoUrl),
    photoVersion: updated.updatedAt,
  })
  const me = useAuthStore.getState().user
  if (me?.id === updated.id) useAuthStore.setState({ user: updated })
}

function applyUserUpdated(data) {
  if (!data.userId) return
  queryClient.removeQueries({ queryKey: ['photo-url', data.userId] })
  patchConversationList((rows) =>
    rows.map((row) => ({
      ...row,
      members: row.members?.map((member) => patchPerson(member, data)),
    })),
  )
  for (const [key, value] of queryClient.getQueriesData({ queryKey: ['conversation'] })) {
    if (!value?.members) continue
    queryClient.setQueryData(key, {
      ...value,
      members: value.members.map((member) => patchPerson(member, data)),
    })
  }
  for (const [key, value] of queryClient.getQueriesData({ queryKey: ['directory'] })) {
    if (value?.pages) {
      queryClient.setQueryData(key, {
        ...value,
        pages: value.pages.map((page) => ({
          ...page,
          data: (page.data ?? []).map((person) => patchPerson(person, data)),
        })),
      })
      continue
    }
    if (!value?.data) continue
    queryClient.setQueryData(key, {
      ...value,
      data: value.data.map((person) => patchPerson(person, data)),
    })
  }
  queryClient.invalidateQueries({ queryKey: ['admin-users'] })
  queryClient.invalidateQueries({ queryKey: queryKeys.me })
  const me = useAuthStore.getState().user
  if (me?.id === data.userId) {
    useAuthStore.setState({
      user: {
        ...me,
        hasProfilePhoto: Boolean(data.hasProfilePhoto),
        profilePhotoUrl: data.hasProfilePhoto ? null : null,
        updatedAt: data.photoVersion || me.updatedAt,
      },
    })
  }
}

export function patchConversationList(updater) {
  queryClient.setQueryData(queryKeys.conversations, (current) => {
    if (!current?.data) return current
    const data = updater(current.data)
    if (data === current.data) return current
    return { ...current, data }
  })
}

function patchGroupsList(conversationId, message, options) {
  queryClient.setQueryData(queryKeys.groups, (current) => {
    if (!Array.isArray(current) || !current.some((row) => row.id === conversationId)) return current
    return applyConversationMessage(current, conversationId, message, options)
  })
}

export function touchConversationFromMessage(conversationId, message) {
  if (!conversationId || !message) return
  const options = {
    event: 'message.created',
    currentUserId: useAuthStore.getState().user?.id,
    viewedConversationId: conversationId,
  }
  patchConversationList((rows) => applyConversationMessage(rows, conversationId, message, options))
  patchGroupsList(conversationId, message, options)
}

export function applyRealtimeEvent(
  event,
  { currentUserId, viewedConversationId = null, onTyping, onPresence, onRevoked } = {},
) {
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

  if (event.event === 'user.updated') {
    applyUserUpdated(data)
    return
  }

  if (event.event === 'typing.updated') {
    onTyping?.(data.conversationId, data.userId, data.typing === true)
    return
  }

  if (event.event === 'conversation.created' || event.event === 'conversation.updated') {
    queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
    queryClient.invalidateQueries({ queryKey: queryKeys.groups })
    if (data.id) {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(data.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.group(data.id) })
      queryClient.removeQueries({ queryKey: ['group-photo-url', data.id] })
    }
    return
  }

  if (event.event === 'notification.created') {
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
    return
  }

  if (event.event === 'message.expired' || event.event === 'message.hidden') {
    const conversationId = data.conversationId
    if (!conversationId || !data.id) return
    queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
      ...current,
      data: removeMessage(current?.data ?? [], data.id),
    }))
    const options = { event: 'message.deleted', currentUserId, viewedConversationId }
    patchConversationList((rows) => applyConversationMessage(rows, conversationId, data, options))
    patchGroupsList(conversationId, data, options)
    return
  }

  if (event.event === 'message.created' || event.event === 'message.updated' || event.event === 'message.deleted') {
    const conversationId = data.conversationId
    if (!conversationId) return
    queryClient.setQueryData(queryKeys.messages(conversationId), (current) => {
      const list = current?.data ?? []
      return { ...current, data: upsertMessage(list, data) }
    })
    const options = { event: event.event, currentUserId, viewedConversationId }
    let missing = false
    patchConversationList((rows) => {
      missing = event.event === 'message.created' && !rows.some((row) => row.id === conversationId)
      return applyConversationMessage(rows, conversationId, data, options)
    })
    patchGroupsList(conversationId, data, options)
    if (missing) queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
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
