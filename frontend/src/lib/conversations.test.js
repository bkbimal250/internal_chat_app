import { describe, expect, it } from 'vitest'
import {
  applyConversationMessage,
  conversationTitle,
  filterConversations,
  previewText,
  sortConversationsByActivity,
} from '@/lib/conversations'

const direct = {
  id: 'd1',
  type: 'direct',
  unreadCount: 2,
  members: [
    { id: 'me', displayName: 'Me' },
    { id: 'you', displayName: 'Jordan Lee', username: 'jordan' },
  ],
  latestMessage: { content: 'Are you free?' },
}

const group = {
  id: 'g1',
  type: 'group',
  title: 'Design',
  unreadCount: 0,
  members: [{ id: 'me' }],
  latestMessage: { content: 'Standup notes' },
}

describe('conversation helpers', () => {
  it('titles direct chats from the other member', () => {
    expect(conversationTitle(direct, 'me')).toBe('Jordan Lee')
    expect(conversationTitle(group, 'me')).toBe('Design')
  })

  it('previews attachment messages without exposing storage keys', () => {
    expect(previewText({ messageType: 'image', content: '' })).toBe('Photo')
    expect(previewText({ messageType: 'file', content: '', attachment: { originalName: 'policy.pdf' } })).toBe(
      'policy.pdf',
    )
  })

  it('filters by unread groups and search', () => {
    const rows = [direct, group]
    expect(filterConversations(rows, { filter: 'unread', currentUserId: 'me' })).toEqual([direct])
    expect(filterConversations(rows, { filter: 'groups', currentUserId: 'me' })).toEqual([group])
    expect(filterConversations(rows, { query: 'jordan', currentUserId: 'me' })).toEqual([direct])
  })

  it('sorts personal and group chats by latest activity', () => {
    const older = { ...direct, updatedAt: '2026-10-01T10:00:00.000Z', latestMessage: { content: 'old', createdAt: '2026-10-01T10:00:00.000Z' } }
    const newer = { ...group, updatedAt: '2026-10-01T12:00:00.000Z', latestMessage: { content: 'new', createdAt: '2026-10-01T12:00:00.000Z' } }
    expect(sortConversationsByActivity([older, newer]).map((row) => row.id)).toEqual(['g1', 'd1'])
    expect(filterConversations([older, newer], { currentUserId: 'me' }).map((row) => row.id)).toEqual(['g1', 'd1'])
  })

  it('moves a conversation to the top when a message is sent or received', () => {
    const rows = [
      { id: 'c1', unreadCount: 0, lastMessageSeq: 1, latestMessage: { id: 'm1', content: 'old', createdAt: '2026-10-01T10:00:00.000Z' } },
      { id: 'c2', unreadCount: 0, lastMessageSeq: 3, latestMessage: { id: 'm2', content: 'idle', createdAt: '2026-10-01T09:00:00.000Z' } },
    ]
    const incoming = {
      id: 'm9',
      conversationId: 'c2',
      senderId: 'you',
      sequenceNumber: 4,
      content: 'hello',
      createdAt: '2026-10-01T12:00:00.000Z',
    }
    const next = applyConversationMessage(rows, 'c2', incoming, { event: 'message.created', currentUserId: 'me' })
    expect(next.map((row) => row.id)).toEqual(['c2', 'c1'])
    expect(next[0].latestMessage.content).toBe('hello')
    expect(next[0].unreadCount).toBe(1)
    expect(next[0].updatedAt).toBe('2026-10-01T12:00:00.000Z')
  })

  it('does not increment unread for own messages, duplicates, or the open chat', () => {
    const rows = [{ id: 'c1', unreadCount: 0, lastMessageSeq: 4, latestMessage: { id: 'm9', clientMessageId: 'x', content: 'hi' } }]
    const mine = applyConversationMessage(rows, 'c1', { id: 'm10', senderId: 'me', sequenceNumber: 5, content: 'sent' }, {
      event: 'message.created',
      currentUserId: 'me',
    })
    expect(mine[0].unreadCount).toBe(0)
    expect(mine[0].latestMessage.content).toBe('sent')

    const duplicate = applyConversationMessage(mine, 'c1', { id: 'm10', senderId: 'you', sequenceNumber: 5, content: 'sent' }, {
      event: 'message.created',
      currentUserId: 'me',
    })
    expect(duplicate[0].unreadCount).toBe(0)

    const viewing = applyConversationMessage(rows, 'c1', { id: 'm11', senderId: 'you', sequenceNumber: 6, content: 'seen' }, {
      event: 'message.created',
      currentUserId: 'me',
      viewedConversationId: 'c1',
    })
    expect(viewing[0].unreadCount).toBe(0)
  })
})
