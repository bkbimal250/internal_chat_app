import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationService, MAX_PINNED } from '../modules/conversations/conversations.service.js';

function fakeDb({ members = {}, pinnedCount = 0 } = {}) {
  const updates = [];
  return {
    updates,
    select() {
      return {
        from() {
          return {
            innerJoin() {
              return {
                async where() {
                  return Object.entries(members)
                    .filter(([, row]) => row.member)
                    .map(([, row]) => ({
                      member: row.member,
                      conversation: row.conversation,
                    }));
                },
              };
            },
            async where() {
              return [{ n: pinnedCount }];
            },
          };
        },
      };
    },
    update() {
      return {
        set(values) {
          updates.push(values);
          return {
            where() {
              const done = {
                then(resolve) {
                  resolve();
                  return done;
                },
                async returning() {
                  return [{ ...values }];
                },
              };
              return done;
            },
          };
        },
      };
    },
  };
}

function member({
  id = 'chat-a',
  lastMessageSeq = 4,
  lastReadSeq = 4,
  pinnedAt = null,
  archivedAt = null,
  hiddenUntilSeq = null,
} = {}) {
  return {
    member: { hiddenUntilSeq, lastReadSeq, leftAt: null, pinnedAt, archivedAt },
    conversation: { lastMessageSeq, type: 'direct', id },
  };
}

test('pin, archive, unread and bulk updates stay on the caller membership', async () => {
  const db = fakeDb({ members: { a: member() } });
  const service = conversationService({ database: { db } });

  const pinned = await service.pin('chat-a', 'user-1', true);
  assert.equal(pinned.pinned, true);
  assert.ok(pinned.pinnedAt);
  assert.equal(pinned.archivedAt, null);
  assert.equal(db.updates.at(-1).archivedAt, null);

  const unpinned = await service.pin('chat-a', 'user-1', false);
  assert.equal(unpinned.pinned, false);
  assert.equal(unpinned.pinnedAt, null);

  const archived = await service.archive('chat-a', 'user-1', true);
  assert.equal(archived.archived, true);
  assert.equal(archived.pinnedAt, null);
  assert.ok(archived.archivedAt);

  const restored = await service.archive('chat-a', 'user-1', false);
  assert.equal(restored.archived, false);
  assert.equal(restored.archivedAt, null);

  const unread = await service.unread('chat-a', 'user-1');
  assert.equal(unread.lastReadSeq, 3);
  assert.equal(unread.unread, true);

  const read = await service.readToLatest('chat-a', 'user-1');
  assert.equal(read.lastReadSeq, 4);
  assert.equal(read.unread, false);

  const missing = conversationService({ database: { db: fakeDb({ members: {} }) } });
  await assert.rejects(() => missing.pin('chat-b', 'user-1', true), (error) => error.code === 'NOT_FOUND');
  const bulk = await missing.pinMany('user-1', ['chat-b', 'chat-c'], true);
  assert.equal(bulk.pinned.length, 0);
  assert.equal(bulk.failed.length, 2);
  assert.equal(bulk.failed[0].code, 'NOT_FOUND');
});

test('pinning more than three chats reports a per-chat pin limit', async () => {
  const db = fakeDb({ members: { a: member() }, pinnedCount: MAX_PINNED });
  const service = conversationService({ database: { db } });
  await assert.rejects(() => service.pin('chat-a', 'user-1', true), (error) => error.code === 'PIN_LIMIT' && error.statusCode === 400);

  const already = fakeDb({
    members: { a: member({ pinnedAt: new Date('2026-01-01T00:00:00.000Z') }) },
    pinnedCount: MAX_PINNED,
  });
  const keep = await conversationService({ database: { db: already } }).pin('chat-a', 'user-1', true);
  assert.equal(keep.pinned, true);
});

test('bulk archive and unread report partial failures and reject empty selections', async () => {
  const db = fakeDb({ members: { a: member({ id: 'chat-a' }) } });
  const service = conversationService({ database: { db } });
  const original = service.assertMember.bind(service);
  service.assertMember = async (id, userId) => {
    if (id === 'missing') {
      const error = new Error('Conversation not found');
      error.code = 'NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    return original(id, userId);
  };

  await assert.rejects(() => service.archiveMany('user-1', []), (error) => error.code === 'EMPTY_SELECTION');
  await assert.rejects(
    () => service.unreadMany('user-1', Array.from({ length: 51 }, (_, i) => `c${i}`)),
    (error) => error.code === 'TOO_MANY',
  );

  const archive = await service.archiveMany('user-1', ['chat-a', 'missing'], true);
  assert.equal(archive.archived.length, 1);
  assert.equal(archive.archived[0].id, 'chat-a');
  assert.equal(archive.failed.length, 1);
  assert.equal(archive.failed[0].id, 'missing');
  assert.equal(archive.failed[0].code, 'NOT_FOUND');
});
