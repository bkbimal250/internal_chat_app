import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/query-client', () => {
  const store = new Map()
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
      invalidateQueries: vi.fn(),
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
        },
      },
      { currentUserId: 'me' },
    )
    const messages = queryClient.store.get(JSON.stringify(queryKeys.messages('c1')))
    expect(messages.data).toHaveLength(1)
    const list = queryClient.store.get(JSON.stringify(queryKeys.conversations))
    expect(list.data[0].unreadCount).toBe(1)
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
