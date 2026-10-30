import { describe, expect, it } from 'vitest'
import { conversationTitle, filterConversations, previewText } from '@/lib/conversations'

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
})
