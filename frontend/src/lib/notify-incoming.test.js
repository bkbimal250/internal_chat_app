import { describe, expect, it } from 'vitest'
import {
  documentIsActive,
  resetSeenMessageIds,
  shouldNotifyIncomingMessage,
  viewedConversationForNotifications,
} from '@/lib/notify-incoming'

const incoming = {
  id: 'm1',
  senderId: 'b',
  conversationId: 'c1',
  content: 'hello',
}

describe('incoming message notifications', () => {
  it('suppresses only the actively viewed focused conversation', () => {
    const seen = new Set()
    expect(
      shouldNotifyIncomingMessage({
        message: incoming,
        currentUserId: 'a',
        viewedConversationId: 'c1',
        documentVisible: true,
        documentFocused: true,
        seen,
      }),
    ).toBe(false)
  })

  it('still notifies for a different conversation', () => {
    const seen = new Set()
    expect(
      shouldNotifyIncomingMessage({
        message: incoming,
        currentUserId: 'a',
        viewedConversationId: 'c2',
        documentVisible: true,
        documentFocused: true,
        seen,
      }),
    ).toBe(true)
  })

  it('notifies when the chat tab is hidden or unfocused', () => {
    const hidden = new Set()
    expect(
      shouldNotifyIncomingMessage({
        message: { ...incoming, id: 'm2' },
        currentUserId: 'a',
        viewedConversationId: 'c1',
        documentVisible: false,
        documentFocused: true,
        seen: hidden,
      }),
    ).toBe(true)
    const blurred = new Set()
    expect(
      shouldNotifyIncomingMessage({
        message: { ...incoming, id: 'm3' },
        currentUserId: 'a',
        viewedConversationId: 'c1',
        documentVisible: true,
        documentFocused: false,
        seen: blurred,
      }),
    ).toBe(true)
  })

  it('never notifies for own messages or duplicate ids', () => {
    const seen = new Set()
    expect(
      shouldNotifyIncomingMessage({
        message: { ...incoming, senderId: 'a' },
        currentUserId: 'a',
        viewedConversationId: 'c2',
        seen,
      }),
    ).toBe(false)
    expect(
      shouldNotifyIncomingMessage({
        message: incoming,
        currentUserId: 'a',
        viewedConversationId: 'c2',
        seen,
      }),
    ).toBe(true)
    expect(
      shouldNotifyIncomingMessage({
        message: incoming,
        currentUserId: 'a',
        viewedConversationId: 'c2',
        seen,
      }),
    ).toBe(false)
  })

  it('treats an inactive document as not viewing the open chat', () => {
    expect(documentIsActive({ visibilityState: 'hidden', hasFocus: true })).toBe(false)
    expect(viewedConversationForNotifications('c1', { visibilityState: 'hidden', hasFocus: true })).toBe(null)
    expect(viewedConversationForNotifications('c1', { visibilityState: 'visible', hasFocus: true })).toBe('c1')
    resetSeenMessageIds()
  })
})
