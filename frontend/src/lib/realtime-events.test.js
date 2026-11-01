import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/query-client', () => {
  const store = new Map()
  const matches = (key, filter) => filter.every((part, index) => key[index] === part)
  return {
    queryClient: {
      store,
      setQueryData: (key, updater) => {
        const id = JSON.stringify(key)
        const current = store.get(id)
        const next = typeof updater === 'function' ? updater(current) : updater
        store.set(id, next)
        return next
      },
      getQueriesData: ({ queryKey }) =>
        [...store.entries()]
          .filter(([id]) => matches(JSON.parse(id), queryKey))
          .map(([id, value]) => [JSON.parse(id), value]),
      removeQueries: ({ queryKey }) => {
        for (const id of [...store.keys()]) {
          if (matches(JSON.parse(id), queryKey)) store.delete(id)
        }
      },
      invalidateQueries: vi.fn(),
    },
  }
})

vi.mock('@/stores/auth-store', () => {
  let user = { id: 'me', hasProfilePhoto: false, profilePhotoUrl: null }
  return {
    useAuthStore: {
      getState: () => ({ user }),
      setState: (next) => {
        user = next.user ?? user
      },
    },
  }
})

import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'
import { applyRealtimeEvent } from '@/lib/realtime-events'

describe('websocket event handling', () => {
  beforeEach(() => {
    queryClient.store.clear()
    queryClient.setQueryData(queryKeys.messages('c1'), { data: [] })
    queryClient.setQueryData(queryKeys.conversations, { data: [{ id: 'c1', unreadCount: 0 }] })
  })

  it('upserts created messages and increments unread for others', () => {
    applyRealtimeEvent(
      {
        event: 'message.created',
        data: {
          id: 'm9',
          conversationId: 'c1',
          senderId: 'other',
          sequenceNumber: 4,
          content: 'hi',
          createdAt: '2026-10-01T12:00:00.000Z',
        },
      },
      { currentUserId: 'me' },
    )
    const messages = queryClient.store.get(JSON.stringify(queryKeys.messages('c1')))
    expect(messages.data).toHaveLength(1)
    const list = queryClient.store.get(JSON.stringify(queryKeys.conversations))
    expect(list.data[0].unreadCount).toBe(1)
    expect(list.data[0].latestMessage.content).toBe('hi')
  })

  it('moves an existing conversation to the top without duplicating it', () => {
    queryClient.setQueryData(queryKeys.conversations, {
      data: [
        { id: 'c-old', unreadCount: 0, lastMessageSeq: 1, latestMessage: { id: 'a', content: 'older' } },
        { id: 'c1', unreadCount: 0, lastMessageSeq: 2, latestMessage: { id: 'b', content: 'idle' } },
      ],
    })
    const payload = {
      event: 'message.created',
      data: {
        id: 'm9',
        conversationId: 'c1',
        senderId: 'other',
        sequenceNumber: 3,
        content: 'newest',
        createdAt: '2026-10-01T12:00:00.000Z',
      },
    }
    applyRealtimeEvent(payload, { currentUserId: 'me' })
    applyRealtimeEvent(payload, { currentUserId: 'me' })
    const list = queryClient.store.get(JSON.stringify(queryKeys.conversations))
    expect(list.data.map((row) => row.id)).toEqual(['c1', 'c-old'])
    expect(list.data[0].unreadCount).toBe(1)
    expect(list.data[0].latestMessage.content).toBe('newest')
  })

  it('keeps unread at zero when the conversation is open', () => {
    applyRealtimeEvent(
      {
        event: 'message.created',
        data: {
          id: 'm9',
          conversationId: 'c1',
          senderId: 'other',
          sequenceNumber: 4,
          content: 'hi',
        },
      },
      { currentUserId: 'me', viewedConversationId: 'c1' },
    )
    const list = queryClient.store.get(JSON.stringify(queryKeys.conversations))
    expect(list.data[0].unreadCount).toBe(0)
    expect(list.data[0].latestMessage.content).toBe('hi')
  })

  it('removes an expired message without a refresh', () => {
    queryClient.setQueryData(queryKeys.messages('c1'), {
      data: [{ id: 'm9', conversationId: 'c1', content: 'old' }],
    })
    applyRealtimeEvent({
      event: 'message.expired',
      data: { id: 'm9', conversationId: 'c1', expired: true },
    })
    const messages = queryClient.store.get(JSON.stringify(queryKeys.messages('c1')))
    expect(messages.data).toHaveLength(0)
  })

  it('invalidates notifications when a reminder arrives', () => {
    applyRealtimeEvent({
      event: 'notification.created',
      data: { id: 'n1', type: 'retention.reminder.30d', title: 'Soon' },
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalled()
  })

  it('removes a message hidden for the current user', () => {
    queryClient.setQueryData(queryKeys.messages('c1'), {
      data: [{ id: 'm9', conversationId: 'c1', content: 'hi' }],
    })
    applyRealtimeEvent({
      event: 'message.hidden',
      data: { id: 'm9', conversationId: 'c1', hidden: true },
    })
    const messages = queryClient.store.get(JSON.stringify(queryKeys.messages('c1')))
    expect(messages.data).toHaveLength(0)
  })

  it('does not duplicate the same message after reconnect', () => {
    const payload = {
      event: 'message.created',
      data: { id: 'm9', conversationId: 'c1', senderId: 'me', sequenceNumber: 4, content: 'hi' },
    }
    applyRealtimeEvent(payload, { currentUserId: 'me' })
    applyRealtimeEvent(payload, { currentUserId: 'me' })
    const messages = queryClient.store.get(JSON.stringify(queryKeys.messages('c1')))
    expect(messages.data).toHaveLength(1)
  })

  it('invalidates group photo caches when a conversation is updated', () => {
    queryClient.setQueryData(queryKeys.groupPhotoUrl('c1', 'v1'), 'https://old')
    applyRealtimeEvent({
      event: 'conversation.updated',
      data: { id: 'c1', hasAvatar: true, settings: { sendMessages: 'admins' } },
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalled()
    expect(queryClient.store.has(JSON.stringify(queryKeys.groupPhotoUrl('c1', 'v1')))).toBe(false)
  })

  it('patches group member roles from realtime events', () => {
    queryClient.setQueryData(queryKeys.conversation('c1'), {
      id: 'c1',
      members: [
        { id: 'me', role: 'owner' },
        { id: 'u2', role: 'member' },
      ],
    })
    applyRealtimeEvent({
      event: 'group.member_updated',
      data: { conversationId: 'c1', userId: 'u2', role: 'admin' },
    })
    const conversation = queryClient.store.get(JSON.stringify(queryKeys.conversation('c1')))
    expect(conversation.members.find((member) => member.id === 'u2').role).toBe('admin')
  })

  it('patches member photos from user.updated events', () => {
    queryClient.setQueryData(queryKeys.conversations, {
      data: [{ id: 'c1', members: [{ id: 'u2', displayName: 'Bea', hasProfilePhoto: false }] }],
    })
    queryClient.setQueryData(queryKeys.conversation('c1'), {
      id: 'c1',
      members: [{ id: 'u2', displayName: 'Bea', hasProfilePhoto: false }],
    })
    applyRealtimeEvent({
      event: 'user.updated',
      data: { userId: 'u2', hasProfilePhoto: true, photoVersion: '2026-10-30T00:00:00.000Z' },
    })
    const list = queryClient.store.get(JSON.stringify(queryKeys.conversations))
    expect(list.data[0].members[0].hasProfilePhoto).toBe(true)
    expect(list.data[0].members[0].photoVersion).toBe('2026-10-30T00:00:00.000Z')
    const conversation = queryClient.store.get(JSON.stringify(queryKeys.conversation('c1')))
    expect(conversation.members[0].hasProfilePhoto).toBe(true)
  })

  it('patches infinite directory pages from user.updated events', () => {
    queryClient.setQueryData(queryKeys.directory({ search: '', limit: 30 }), {
      pages: [
        {
          data: [{ id: 'u2', displayName: 'Bea', hasProfilePhoto: false }],
          page: 1,
          limit: 30,
          total: 1,
        },
      ],
      pageParams: [1],
    })
    applyRealtimeEvent({
      event: 'user.updated',
      data: { userId: 'u2', hasProfilePhoto: true, photoVersion: '2026-10-30T00:00:00.000Z' },
    })
    const directory = queryClient.store.get(JSON.stringify(queryKeys.directory({ search: '', limit: 30 })))
    expect(directory.pages[0].data[0].hasProfilePhoto).toBe(true)
    expect(directory.pages[0].data[0].photoVersion).toBe('2026-10-30T00:00:00.000Z')
  })

  it('notifies presence typing and revocation handlers', () => {
    const onPresence = vi.fn()
    const onTyping = vi.fn()
    const onRevoked = vi.fn()
    applyRealtimeEvent({ event: 'presence.updated', data: { userId: 'u2', online: true } }, { onPresence })
    applyRealtimeEvent(
      { event: 'typing.updated', data: { conversationId: 'c1', userId: 'u2', typing: true } },
      { onTyping },
    )
    applyRealtimeEvent({ event: 'session.revoked', data: {} }, { onRevoked })
    expect(onPresence).toHaveBeenCalledWith('u2', true)
    expect(onTyping).toHaveBeenCalledWith('c1', 'u2', true)
    expect(onRevoked).toHaveBeenCalled()
  })
})
