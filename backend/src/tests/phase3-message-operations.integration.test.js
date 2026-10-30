import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';
import { eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { conversations, messages, users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const PRIVATE_EVENTS = new Set([
  'conversation.created',
  'conversation.updated',
  'group.member_added',
  'group.member_removed',
  'group.member_updated',
  'group.member_left',
  'group.owner_transferred',
  'message.created',
  'message.updated',
  'message.deleted',
  'typing.updated',
  'receipt.updated',
]);

const waitEvent = (socket, event, predicate = () => true) =>
  new Promise((resolve, reject) => {
    const match = (message) => message.event === event && predicate(message);
    const existing = socket.chatEvents.find(match);
    if (existing) return resolve(existing);
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(
        new Error(
          `Timed out waiting for ${event} on ${socket.label}; recent ${JSON.stringify(socket.chatEvents.slice(-12))}`,
        ),
      );
    }, 5000);
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString());
      if (!match(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
    const raced = socket.chatEvents.find(match);
    if (raced) {
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(raced);
    }
  });

const waitNew = (socket, mark, event, predicate = () => true) =>
  waitEvent(socket, event, (message) => {
    const index = socket.chatEvents.findIndex((item) => item.eventId === message.eventId);
    return (index === -1 || index >= mark) && predicate(message);
  });

const flush = async (socket) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  const mark = socket.chatEvents.length;
  socket.send(JSON.stringify({ event: 'ping' }));
  await waitNew(socket, mark, 'pong');
};

const leaked = (socket, mark) => socket.chatEvents.slice(mark).filter((item) => PRIVATE_EVENTS.has(item.event));

const open = async (url, token, label) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.label = label;
  socket.chatEvents = [];
  socket.on('message', (raw) => socket.chatEvents.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await waitEvent(socket, 'connection.ready');
  return socket;
};

test('Phase 3 Batch 2B: message edit, delete, reply, forward, idempotency, pagination and WebSocket', { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' }, async (t) => {
  const config = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testUrl,
    JWT_SECRET: 'batch-two-b-secret-'.repeat(4),
  });
  const app = await buildApp({ config });
  t.after(() => app.close());
  await app.database.db.execute(
    sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
  );
  const password = 'Batch-Two-B-Password-9!';
  const hash = await hashPassword(password);
  const [a, b, c, d] = await app.database.db
    .insert(users)
    .values(['op-a', 'op-b', 'op-c', 'op-d'].map((username) => ({
      username,
      displayName: username,
      passwordHash: hash,
      mustChangePassword: false,
    })))
    .returning();
  const auth = authService(app, config);
  const login = (user, device) =>
    auth.login(
      { username: user.username, password, clientType: 'native', platform: 'android', deviceName: device },
      { ip: '127.0.0.1' },
    );
  const [sessionA, sessionB1, sessionB2, sessionC, sessionD] = await Promise.all([
    login(a, 'a'),
    login(b, 'b1'),
    login(b, 'b2'),
    login(c, 'c'),
    login(d, 'd'),
  ]);
  const token = (result) => accessToken(app, result.user, result.session);
  const header = (result) => ({ authorization: `Bearer ${token(result)}` });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = address.replace('http:', 'ws:') + '/api/v1/ws';
  const [aSocket, bSocket1, bSocket2, cSocket, dSocket] = await Promise.all([
    open(url, token(sessionA), 'A'),
    open(url, token(sessionB1), 'B1'),
    open(url, token(sessionB2), 'B2'),
    open(url, token(sessionC), 'C'),
    open(url, token(sessionD), 'D'),
  ]);
  t.after(() => [aSocket, bSocket1, bSocket2, cSocket, dSocket].forEach((socket) => socket.terminate()));
  const isolated = [cSocket];
  const assertIsolated = async (action, watcher, event, predicate) => {
    const watcherMark = watcher.chatEvents.length;
    const marks = isolated.map((socket) => socket.chatEvents.length);
    await action();
    const received = await waitNew(watcher, watcherMark, event, predicate);
    for (const [index, socket] of isolated.entries()) {
      await flush(socket);
      assert.equal(
        leaked(socket, marks[index]).length,
        0,
        `${socket.label} leaked ${event}: ${JSON.stringify(leaked(socket, marks[index]))}`,
      );
    }
    return received;
  };
  const postMessage = (conversationId, session, payload) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversationId}/messages`,
      headers: header(session),
      payload,
    });
  const listMessages = (conversationId, session, afterSeq, limit) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conversationId}/messages?afterSeq=${afterSeq}&limit=${limit}`,
      headers: header(session),
    });

  const directReply = await app.inject({
    method: 'POST',
    url: '/api/v1/conversations/direct',
    headers: header(sessionA),
    payload: { userId: b.id },
  });
  assert.equal(directReply.statusCode, 201);
  const direct = directReply.json();
  const groupReply = await app.inject({
    method: 'POST',
    url: '/api/v1/groups',
    headers: header(sessionA),
    payload: { title: 'Operations group' },
  });
  assert.equal(groupReply.statusCode, 201);
  const group = groupReply.json();
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${group.id}/members`,
      headers: header(sessionA),
      payload: { userId: b.id },
    })).statusCode,
    201,
  );
  const otherGroupReply = await app.inject({
    method: 'POST',
    url: '/api/v1/groups',
    headers: header(sessionA),
    payload: { title: 'Forward target' },
  });
  assert.equal(otherGroupReply.statusCode, 201);
  const otherGroup = otherGroupReply.json();
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${otherGroup.id}/members`,
      headers: header(sessionA),
      payload: { userId: d.id },
    })).statusCode,
    201,
  );
  await waitEvent(bSocket1, 'group.member_added', (event) => event.data.userId === b.id);
  await waitEvent(dSocket, 'group.member_added', (event) => event.data.userId === d.id);

  const seeded = [];
  for (let index = 0; index < 7; index += 1) {
    const created = await assertIsolated(
      () => postMessage(direct.id, sessionA, { clientMessageId: randomUUID(), content: `page-${index}` }),
      bSocket1,
      'message.created',
      (event) => event.data.content === `page-${index}`,
    );
    seeded.push(created.data);
  }
  assert.ok(seeded.every((row, index) => index === 0 || row.sequenceNumber > seeded[index - 1].sequenceNumber));
  const page1 = await listMessages(direct.id, sessionA, 0, 3);
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().data.length, 3);
  assert.equal(page1.json().nextAfterSeq, page1.json().data[2].sequenceNumber);
  assert.deepEqual(
    page1.json().data.map((row) => row.id),
    seeded.slice(0, 3).map((row) => row.id),
  );
  const extra = await Promise.all(
    ['concurrent-a', 'concurrent-b', 'concurrent-c'].map((content) =>
      postMessage(direct.id, sessionB1, { clientMessageId: randomUUID(), content }),
    ),
  );
  assert.ok(extra.every((reply) => reply.statusCode === 201));
  const page2 = await listMessages(direct.id, sessionA, page1.json().nextAfterSeq, 3);
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().data.length, 3);
  const page1Ids = new Set(page1.json().data.map((row) => row.id));
  assert.ok(page2.json().data.every((row) => !page1Ids.has(row.id)));
  const collected = [];
  let afterSeq = 0;
  let safety = 0;
  while (safety < 20) {
    const page = (await listMessages(direct.id, sessionB1, afterSeq, 3)).json();
    collected.push(...page.data);
    if (!page.nextAfterSeq) break;
    afterSeq = page.nextAfterSeq;
    safety += 1;
  }
  const ids = collected.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(collected.every((row, index) => index === 0 || row.sequenceNumber > collected[index - 1].sequenceNumber));
  assert.ok(seeded.every((row) => ids.includes(row.id)));
  assert.ok(extra.every((reply) => ids.includes(reply.json().id)));
  const lastSeq = collected[collected.length - 1].sequenceNumber;
  const empty = await listMessages(direct.id, sessionA, lastSeq, 3);
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { data: [], nextAfterSeq: null });
  const beyond = await listMessages(direct.id, sessionA, lastSeq + 50, 3);
  assert.deepEqual(beyond.json(), { data: [], nextAfterSeq: null });
  assert.equal((await listMessages(direct.id, sessionC, 0, 3)).statusCode, 404);
  assert.equal((await postMessage(direct.id, sessionA, { content: 'missing client id' })).statusCode, 400);
  assert.equal(
    (await postMessage(direct.id, sessionA, { clientMessageId: randomUUID(), content: '   ' })).statusCode,
    400,
  );

  const duplicateId = randomUUID();
  const first = await postMessage(direct.id, sessionA, { clientMessageId: duplicateId, content: 'idempotent original' });
  assert.equal(first.statusCode, 201);
  await waitEvent(bSocket1, 'message.created', (event) => event.data.id === first.json().id);
  const [beforeSeq] = await app.database.db.select().from(conversations).where(eq(conversations.id, direct.id));
  const bMark = bSocket1.chatEvents.length;
  const b2Mark = bSocket2.chatEvents.length;
  const retry = await postMessage(direct.id, sessionA, { clientMessageId: duplicateId, content: 'idempotent retry' });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().id, first.json().id);
  assert.equal(retry.json().content, 'idempotent original');
  const [afterSeqRow] = await app.database.db.select().from(conversations).where(eq(conversations.id, direct.id));
  assert.equal(afterSeqRow.lastMessageSeq, beforeSeq.lastMessageSeq);
  await flush(bSocket1);
  await flush(bSocket2);
  assert.equal(bSocket1.chatEvents.slice(bMark).filter((event) => event.event === 'message.created').length, 0);
  assert.equal(bSocket2.chatEvents.slice(b2Mark).filter((event) => event.event === 'message.created').length, 0);
  const concurrentId = randomUUID();
  const concurrent = await Promise.all(
    Array.from({ length: 8 }, () =>
      postMessage(direct.id, sessionA, { clientMessageId: concurrentId, content: 'concurrent idempotent' }),
    ),
  );
  assert.equal(concurrent.filter((reply) => reply.statusCode === 201).length, 1);
  assert.equal(concurrent.filter((reply) => reply.statusCode === 200).length, 7);
  assert.ok(concurrent.every((reply) => reply.json().id === concurrent[0].json().id));
  const [{ copies }] = await app.database.db
    .select({ copies: sql`count(*)::int` })
    .from(messages)
    .where(eq(messages.clientMessageId, concurrentId));
  assert.equal(copies, 1);
  await waitEvent(bSocket2, 'message.created', (event) => event.data.clientMessageId === concurrentId);
  await flush(bSocket1);
  await flush(bSocket2);
  assert.equal(
    bSocket1.chatEvents.filter((event) => event.event === 'message.created' && event.data.clientMessageId === concurrentId)
      .length,
    1,
  );
  assert.equal(
    bSocket2.chatEvents.filter((event) => event.event === 'message.created' && event.data.clientMessageId === concurrentId)
      .length,
    1,
  );

  const parent = first.json();
  const directAnswer = await assertIsolated(
    () =>
      postMessage(direct.id, sessionB1, {
        clientMessageId: randomUUID(),
        content: 'direct reply',
        replyToMessageId: parent.id,
      }),
    aSocket,
    'message.created',
    (event) => event.data.content === 'direct reply',
  );
  assert.equal(directAnswer.data.replyToMessageId, parent.id);
  assert.equal(directAnswer.data.conversationId, direct.id);
  const groupParent = await postMessage(group.id, sessionA, { clientMessageId: randomUUID(), content: 'group parent' });
  assert.equal(groupParent.statusCode, 201);
  const groupAnswer = await assertIsolated(
    () =>
      postMessage(group.id, sessionB1, {
        clientMessageId: randomUUID(),
        content: 'group reply',
        replyToMessageId: groupParent.json().id,
      }),
    aSocket,
    'message.created',
    (event) => event.data.content === 'group reply',
  );
  assert.equal(groupAnswer.data.replyToMessageId, groupParent.json().id);
  assert.equal(
    (await postMessage(direct.id, sessionA, {
      clientMessageId: randomUUID(),
      content: 'cross conversation',
      replyToMessageId: groupParent.json().id,
    })).statusCode,
    400,
  );
  assert.equal(
    (await postMessage(direct.id, sessionA, {
      clientMessageId: randomUUID(),
      content: 'missing parent',
      replyToMessageId: randomUUID(),
    })).json().error.code,
    'INVALID_REFERENCE',
  );

  const forwarded = await assertIsolated(
    async () => {
      const reply = await app.inject({
        method: 'POST',
        url: `/api/v1/messages/${parent.id}/forward`,
        headers: header(sessionA),
        payload: { conversationId: group.id, clientMessageId: randomUUID(), content: parent.content },
      });
      assert.equal(reply.statusCode, 201);
      assert.equal(reply.json().forwardedFromMessageId, parent.id);
      assert.equal(reply.json().conversationId, group.id);
    },
    bSocket1,
    'message.created',
    (event) => event.data.forwardedFromMessageId === parent.id,
  );
  assert.equal(forwarded.data.senderId, a.id);
  const toOther = await app.inject({
    method: 'POST',
    url: `/api/v1/messages/${parent.id}/forward`,
    headers: header(sessionA),
    payload: { conversationId: otherGroup.id, clientMessageId: randomUUID(), content: parent.content },
  });
  assert.equal(toOther.statusCode, 201);
  await waitEvent(dSocket, 'message.created', (event) => event.data.id === toOther.json().id);
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${parent.id}/forward`,
      headers: header(sessionD),
      payload: { conversationId: otherGroup.id, clientMessageId: randomUUID(), content: parent.content },
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${parent.id}/forward`,
      headers: header(sessionB1),
      payload: { conversationId: otherGroup.id, clientMessageId: randomUUID(), content: parent.content },
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${parent.id}/forward`,
      headers: header(sessionC),
      payload: { conversationId: group.id, clientMessageId: randomUUID(), content: parent.content },
    })).statusCode,
    404,
  );
  const groupHistory = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${group.id}/messages?afterSeq=0&limit=20`,
    headers: header(sessionA),
  });
  const systemMessage = groupHistory.json().data.find((row) => row.messageType === 'system');
  assert.ok(systemMessage);
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${systemMessage.id}/forward`,
      headers: header(sessionA),
      payload: { conversationId: direct.id, clientMessageId: randomUUID(), content: 'system forward' },
    })).json().error.code,
    'INVALID_REFERENCE',
  );
  const forwardDup = randomUUID();
  const firstForward = await app.inject({
    method: 'POST',
    url: `/api/v1/messages/${parent.id}/forward`,
    headers: header(sessionA),
    payload: { conversationId: group.id, clientMessageId: forwardDup, content: parent.content },
  });
  assert.equal(firstForward.statusCode, 201);
  const retryForward = await app.inject({
    method: 'POST',
    url: `/api/v1/messages/${parent.id}/forward`,
    headers: header(sessionA),
    payload: { conversationId: group.id, clientMessageId: forwardDup, content: 'ignored' },
  });
  assert.equal(retryForward.statusCode, 200);
  assert.equal(retryForward.json().id, firstForward.json().id);

  const editable = await postMessage(direct.id, sessionA, { clientMessageId: randomUUID(), content: 'edit me' });
  assert.equal(editable.statusCode, 201);
  const edited = await assertIsolated(
    async () => {
      const reply = await app.inject({
        method: 'PATCH',
        url: `/api/v1/messages/${editable.json().id}`,
        headers: header(sessionA),
        payload: { content: 'edited text' },
      });
      assert.equal(reply.statusCode, 200);
      assert.equal(reply.json().content, 'edited text');
      assert.ok(reply.json().editedAt);
    },
    bSocket1,
    'message.updated',
    (event) => event.data.id === editable.json().id && event.data.content === 'edited text',
  );
  await waitEvent(bSocket2, 'message.updated', (event) => event.data.id === editable.json().id);
  assert.equal(edited.data.senderId, a.id);
  const fetched = await app.inject({
    method: 'GET',
    url: `/api/v1/messages/${editable.json().id}`,
    headers: header(sessionB1),
  });
  assert.equal(fetched.json().content, 'edited text');
  assert.equal(
    (await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${editable.json().id}`,
      headers: header(sessionB1),
      payload: { content: 'hijack' },
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${systemMessage.id}`,
      headers: header(sessionA),
      payload: { content: 'rewrite system' },
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${editable.json().id}`,
      headers: header(sessionA),
      payload: { content: '   ' },
    })).statusCode,
    400,
  );
  const expiredEdit = await postMessage(direct.id, sessionA, { clientMessageId: randomUUID(), content: 'too old to edit' });
  await app.database.db.execute(
    sql`update messages set created_at = now() - interval '16 minutes' where id = ${expiredEdit.json().id}::uuid`,
  );
  assert.equal(
    (await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${expiredEdit.json().id}`,
      headers: header(sessionA),
      payload: { content: 'late edit' },
    })).json().error.code,
    'EDIT_WINDOW_EXPIRED',
  );
  const [unchanged] = await app.database.db.select().from(messages).where(eq(messages.id, expiredEdit.json().id));
  assert.equal(unchanged.content, 'too old to edit');
  assert.equal(unchanged.editedAt, null);

  const deletable = await postMessage(direct.id, sessionA, { clientMessageId: randomUUID(), content: 'delete me' });
  assert.equal(deletable.statusCode, 201);
  const deleted = await assertIsolated(
    async () => {
      const reply = await app.inject({
        method: 'DELETE',
        url: `/api/v1/messages/${deletable.json().id}`,
        headers: header(sessionA),
      });
      assert.equal(reply.statusCode, 200);
      assert.equal(reply.json().content, '');
      assert.ok(reply.json().deletedAt);
    },
    bSocket1,
    'message.deleted',
    (event) => event.data.id === deletable.json().id && event.data.content === '',
  );
  await waitEvent(bSocket2, 'message.deleted', (event) => event.data.id === deletable.json().id);
  assert.ok(deleted.data.deletedAt);
  const tombstone = await app.inject({
    method: 'GET',
    url: `/api/v1/messages/${deletable.json().id}`,
    headers: header(sessionB1),
  });
  assert.equal(tombstone.statusCode, 200);
  assert.equal(tombstone.json().content, '');
  assert.ok(tombstone.json().deletedAt);
  const history = await listMessages(direct.id, sessionA, 0, 100);
  const storedTombstone = history.json().data.find((row) => row.id === deletable.json().id);
  assert.ok(storedTombstone);
  assert.equal(storedTombstone.content, '');
  assert.ok(storedTombstone.deletedAt);
  assert.equal(
    (await postMessage(direct.id, sessionB1, {
      clientMessageId: randomUUID(),
      content: 'reply to deleted',
      replyToMessageId: deletable.json().id,
    })).json().error.code,
    'INVALID_REFERENCE',
  );
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${deletable.json().id}/forward`,
      headers: header(sessionA),
      payload: { conversationId: group.id, clientMessageId: randomUUID(), content: 'forward deleted' },
    })).json().error.code,
    'INVALID_REFERENCE',
  );
  assert.equal(
    (await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${deletable.json().id}`,
      headers: header(sessionA),
      payload: { content: 'revive' },
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/messages/${deletable.json().id}`,
      headers: header(sessionA),
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/messages/${editable.json().id}`,
      headers: header(sessionB1),
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/messages/${systemMessage.id}`,
      headers: header(sessionA),
    })).statusCode,
    404,
  );
  const expiredDelete = await postMessage(direct.id, sessionA, { clientMessageId: randomUUID(), content: 'too old to delete' });
  await app.database.db.execute(
    sql`update messages set created_at = now() - interval '16 minutes' where id = ${expiredDelete.json().id}::uuid`,
  );
  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/messages/${expiredDelete.json().id}`,
      headers: header(sessionA),
    })).json().error.code,
    'DELETE_WINDOW_EXPIRED',
  );
  const [stillPresent] = await app.database.db.select().from(messages).where(eq(messages.id, expiredDelete.json().id));
  assert.equal(stillPresent.content, 'too old to delete');
  assert.equal(stillPresent.deletedAt, null);
  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/v1/messages/${deletable.json().id}`, headers: header(sessionC) }))
      .statusCode,
    404,
  );
  await flush(cSocket);
  assert.equal(
    cSocket.chatEvents.filter((event) => PRIVATE_EVENTS.has(event.event)).length,
    0,
    JSON.stringify(cSocket.chatEvents.filter((event) => PRIVATE_EVENTS.has(event.event))),
  );
  assert.equal(bSocket1.readyState, WebSocket.OPEN);
  assert.equal(bSocket2.readyState, WebSocket.OPEN);
});
