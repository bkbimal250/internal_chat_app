import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationService } from '../modules/conversations/conversations.service.js';

function fakeDb({ member = true, lastMessageSeq = 4 } = {}) {
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
                  if (!member) return [];
                  return [
                    {
                      member: { hiddenUntilSeq: null, lastReadSeq: 0, leftAt: null },
                      conversation: { lastMessageSeq, type: 'direct' },
                    },
                  ];
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(values) {
          return {
            async where() {
              updates.push(values);
            },
          };
        },
      };
    },
  };
}

test('hideMany rejects an empty selection and more than 50 chats', async () => {
  const service = conversationService({ database: { db: fakeDb() } });
  await assert.rejects(() => service.hideMany('user-1', []), (error) => error.code === 'EMPTY_SELECTION' && error.statusCode === 400);
  await assert.rejects(() => service.hideMany('user-1', null), (error) => error.code === 'EMPTY_SELECTION');
  await assert.rejects(
    () => service.hideMany('user-1', Array.from({ length: 51 }, (_, i) => `c${i}`)),
    (error) => error.code === 'TOO_MANY' && error.statusCode === 400,
  );
});

test('hide is idempotent, unique, and limited to the caller membership', async () => {
  const db = fakeDb({ lastMessageSeq: 7 });
  const service = conversationService({ database: { db } });
  const once = await service.hideMany('user-1', ['chat-a', 'chat-a']);
  assert.deepEqual(
    once.hidden.map((row) => row.id),
    ['chat-a'],
  );
  assert.equal(once.hidden[0].hiddenUntilSeq, 7);
  assert.equal(once.failed.length, 0);
  assert.equal(db.updates.length, 1);
  assert.equal(db.updates[0].hiddenUntilSeq, 7);

  const again = await service.hide('chat-a', 'user-1');
  assert.equal(again.hiddenUntilSeq, 7);
  assert.equal(again.success, true);
  assert.equal(db.updates.length, 2);

  const missing = conversationService({ database: { db: fakeDb({ member: false }) } });
  await assert.rejects(() => missing.hide('chat-b', 'user-1'), (error) => error.code === 'NOT_FOUND' && error.statusCode === 404);
  const bulkMissing = await missing.hideMany('user-1', ['chat-b', 'chat-c']);
  assert.equal(bulkMissing.hidden.length, 0);
  assert.equal(bulkMissing.failed.length, 2);
  assert.equal(bulkMissing.failed[0].code, 'NOT_FOUND');
});
