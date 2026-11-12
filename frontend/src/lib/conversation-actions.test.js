import { describe, expect, it } from 'vitest'
import {
  applyHideToList,
  applyUpdatesToList,
  bulkErrorMessage,
  hideChatsTitle,
  MAX_PINNED,
  mergeArchive,
  mergeMute,
  mergePin,
  mergeRead,
  mergeUnread,
  parseBulkResult,
  selectionSnapshot,
} from '@/lib/conversation-actions'

const chat = (id, extra = {}) => ({
  id,
  unreadCount: 0,
  lastMessageSeq: 4,
  updatedAt: '2026-11-12T00:00:00.000Z',
  ...extra,
})

describe('conversation actions', () => {
  it('titles delete confirmation for one or many chats', () => {
    expect(hideChatsTitle(1)).toBe('Delete this chat?')
    expect(hideChatsTitle(3)).toBe('Delete 3 chats?')
  })

  it('hides a single chat and restores failed ids', () => {
    const previous = [chat('c1'), chat('c2', { displayName: 'Deleted employee' }), chat('c3')]
    const result = parseBulkResult(
      { hidden: [{ id: 'c1', hiddenUntilSeq: 4 }, { id: 'c2', hiddenUntilSeq: 4 }], failed: [{ id: 'c3', message: 'Denied' }] },
      { requested: ['c1', 'c2', 'c3'], key: 'hidden' },
    )
    const next = applyHideToList(previous, previous, result)
    expect(next.map((row) => row.id)).toEqual(['c3'])
    expect(bulkErrorMessage(result, 'delete')).toContain('could not be delete')
  })

  it('keeps a hidden chat out of the list until a newer sequence arrives', () => {
    const hidden = applyHideToList([chat('c1')], [chat('c1')], {
      updated: [{ id: 'c1', hiddenUntilSeq: 4 }],
      failed: [],
    })
    expect(hidden).toEqual([])
    const newer = applyHideToList([chat('c1', { lastMessageSeq: 5 })], [], {
      updated: [{ id: 'c1', hiddenUntilSeq: 4 }],
      failed: [],
    })
    expect(newer).toHaveLength(1)
  })

  it('parses pin-limit partial failures', () => {
    const result = parseBulkResult(
      {
        pinned: [{ id: 'a', pinnedAt: '2026-11-12T00:00:00.000Z' }],
        failed: [{ id: 'b', code: 'PIN_LIMIT', message: 'You can pin up to 3 chats' }],
      },
      { requested: ['a', 'b'], key: 'pinned' },
    )
    expect(result.updated).toHaveLength(1)
    expect(result.failed[0].code).toBe('PIN_LIMIT')
    expect(MAX_PINNED).toBe(3)
    const next = applyUpdatesToList(
      [chat('a'), chat('b'), chat('c', { pinnedAt: '2026-01-01T00:00:00.000Z' })],
      [chat('a'), chat('b'), chat('c', { pinnedAt: '2026-01-01T00:00:00.000Z' })],
      result,
      mergePin,
    )
    expect(next.find((row) => row.id === 'a').pinnedAt).toBeTruthy()
    expect(next.find((row) => row.id === 'b').pinnedAt).toBeFalsy()
  })

  it('moves archived chats out of the inbox and back on unarchive', () => {
    const inbox = [chat('c1'), chat('c2')]
    const archived = parseBulkResult(
      { archived: [{ id: 'c1', archivedAt: '2026-11-12T00:00:00.000Z', pinnedAt: null }] },
      { requested: ['c1'], key: 'archived' },
    )
    const nextInbox = applyUpdatesToList(inbox, inbox, archived, mergeArchive, (row) => !row.archivedAt)
    const nextArchived = applyUpdatesToList([], inbox, archived, mergeArchive, (row) => Boolean(row.archivedAt))
    expect(nextInbox.map((row) => row.id)).toEqual(['c2'])
    expect(nextArchived.map((row) => row.id)).toEqual(['c1'])
  })

  it('mutes, reads and unreads the selected rows', () => {
    const rows = [chat('c1', { unreadCount: 2 }), chat('c2', { unreadCount: 0 })]
    const muted = applyUpdatesToList(
      rows,
      rows,
      parseBulkResult({ muted: [{ conversationId: 'c1', mutedUntil: '2099-01-01T00:00:00.000Z' }] }, { requested: ['c1'], key: 'muted' }),
      mergeMute,
    )
    expect(muted[0].mutedUntil).toContain('2099')
    const read = applyUpdatesToList(rows, rows, { updated: [{ id: 'c1', lastReadSeq: 4 }], failed: [] }, mergeRead)
    expect(read[0].unreadCount).toBe(0)
    const unread = applyUpdatesToList(read, rows, { updated: [{ id: 'c1', lastReadSeq: 3 }], failed: [] }, mergeUnread)
    expect(unread[0].unreadCount).toBe(1)
  })

  it('drives mixed toolbar labels from the selection snapshot', () => {
    const snapshot = selectionSnapshot([
      chat('c1', { pinnedAt: '2026-11-12T00:00:00.000Z', unreadCount: 0 }),
      chat('c2', { mutedUntil: '2099-01-01T00:00:00.000Z', unreadCount: 3 }),
    ])
    expect(snapshot.count).toBe(2)
    expect(snapshot.allPinned).toBe(false)
    expect(snapshot.anyPinned).toBe(true)
    expect(snapshot.allMuted).toBe(false)
    expect(snapshot.anyUnread).toBe(true)
    expect(snapshot.anyRead).toBe(true)
  })
})
