import { describe, expect, it } from 'vitest'
import { remoteTypingNames, typingLabel } from '@/lib/typing-label'

describe('typing labels', () => {
  const members = [
    { id: 'a', displayName: 'Rahul' },
    { id: 'b', displayName: 'Priya' },
    { id: 'c', displayName: 'Amit' },
    { id: 'me', displayName: 'Me' },
  ]

  it('shows the remote person, never the current user', () => {
    expect(typingLabel(remoteTypingNames(['a'], members, 'me'))).toBe('Rahul is typing...')
    expect(typingLabel(remoteTypingNames(['b'], members, 'a'))).toBe('Priya is typing...')
    expect(typingLabel(remoteTypingNames(['me'], members, 'me'))).toBe('')
    expect(typingLabel(remoteTypingNames(['me', 'me'], members, 'me'))).toBe('')
  })

  it('names two people and counts larger groups', () => {
    expect(typingLabel(remoteTypingNames(['a', 'b'], members, 'me'))).toBe('Rahul and Priya are typing...')
    expect(typingLabel(remoteTypingNames(['a', 'b', 'c'], members, 'me'))).toBe('3 people are typing...')
  })

  it('dedupes multi-device events for the same user', () => {
    expect(typingLabel(remoteTypingNames(['a', 'a'], members, 'me'))).toBe('Rahul is typing...')
  })
})
