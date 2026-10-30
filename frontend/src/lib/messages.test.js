import { describe, expect, it } from 'vitest'
import {
  applySyncRecords,
  canMutateMessage,
  newestChangeSeq,
  newestSequence,
  receiptStatus,
  upsertMessage,
} from '@/lib/messages'

const base = {
  id: 'm1',
  clientMessageId: 'c1',
  senderId: 'u1',
  sequenceNumber: 1,
  changeSeq: 1,
  content: 'hello',
  messageType: 'text',
  createdAt: new Date().toISOString(),
}

describe('message cache', () => {
  it('upserts by server id and replaces optimistic client ids', () => {
    const optimistic = { ...base, id: 'c1', pending: true }
    const saved = { ...base, id: 'server-1', pending: false }
    const next = upsertMessage([optimistic], saved)
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('server-1')
    expect(next[0].pending).toBe(false)
  })

  it('applies later edits and deletes without duplicating', () => {
    const edited = { ...base, content: 'hello there', editedAt: new Date().toISOString(), changeSeq: 2 }
    const deleted = { ...edited, deletedAt: new Date().toISOString(), content: '', changeSeq: 3 }
    const next = applySyncRecords([base], [edited, deleted])
    expect(next).toHaveLength(1)
    expect(next[0].deletedAt).toBeTruthy()
    expect(newestChangeSeq(next)).toBe(3)
    expect(newestSequence(next)).toBe(1)
  })

  it('only allows author mutations inside the 15-minute window', () => {
    const old = { ...base, createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() }
    expect(canMutateMessage(base, 'u1')).toBe(true)
    expect(canMutateMessage(base, 'u2')).toBe(false)
    expect(canMutateMessage(old, 'u1')).toBe(false)
  })

  it('derives sent delivered and read ticks', () => {
    const members = [
      { id: 'u1', lastReadSeq: 1 },
      { id: 'u2', lastReadSeq: 1 },
    ]
    expect(receiptStatus(base, { currentUserId: 'u1', members, receipts: [] })).toBe('read')
    expect(
      receiptStatus(
        { ...base, sequenceNumber: 4 },
        { currentUserId: 'u1', members, receipts: [{ messageId: 'm1', deliveredAt: 'now' }] },
      ),
    ).toBe('delivered')
  })
})
