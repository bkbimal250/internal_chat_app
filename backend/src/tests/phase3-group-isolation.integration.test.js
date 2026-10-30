import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';
import { and, eq, sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import {
  conversationMembers,
  conversations,
  messageReceipts,
  messages,
  sessions,
  users,
} from '../database/schema/index.js';
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
  socket.chatClose = null;
  socket.closed = new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      socket.chatClose = { code, reason: reason.toString() };
      resolve(socket.chatClose);
    });
  });
  socket.on('message', (raw) => socket.chatEvents.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await waitEvent(socket, 'connection.ready');
  return socket;
};

const assertFanout = async ({ action, watcher, event, predicate = () => true, isolated }) => {
  const watcherMark = watcher.chatEvents.length;
  const marks = isolated.map((socket) => socket.chatEvents.length);
  await action();
  const received = await waitNew(watcher, watcherMark, event, predicate);
  for (const [index, socket] of isolated.entries()) {
    await flush(socket);
    assert.equal(
      leaked(socket, marks[index]).length,
      0,
      `${socket.label} received prohibited ${event}: ${JSON.stringify(leaked(socket, marks[index]))}`,
    );
  }
  return received;
};

test('Phase 3 Batch 2A: removed-member group event isolation', { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' }, async (t) => {
  const config = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testUrl,
    JWT_SECRET: 'group-isolation-secret-'.repeat(4),
  });
  const app = await buildApp({ config });
  t.after(() => app.close());
  await app.database.db.execute(
    sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
  );
  const password = 'Group-Isolation-Password-9!';
  const hash = await hashPassword(password);
  const people = await app.database.db
    .insert(users)
    .values(['iso-a', 'iso-b', 'iso-c', 'iso-d', 'iso-e'].map((username) => ({
      username,
      displayName: username,
      passwordHash: hash,
      mustChangePassword: false,
    })))
    .returning();
  const [a, b, c, d, e] = people;
  const auth = authService(app, config);
  const login = (user, device) =>
    auth.login(
      { username: user.username, password, clientType: 'native', platform: 'android', deviceName: device },
      { ip: '127.0.0.1' },
    );
  const [sessionA, sessionB, sessionC, sessionD, sessionE] = await Promise.all([
    login(a, 'a'),
    login(b, 'b'),
    login(c, 'c'),
    login(d, 'd'),
    login(e, 'e'),
  ]);
  const token = (result) => accessToken(app, result.user, result.session);
  const header = (result) => ({ authorization: `Bearer ${token(result)}` });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = address.replace('http:', 'ws:') + '/api/v1/ws';
  const [aSocket, bSocket, cSocket, dSocket, eSocket] = await Promise.all([
    open(url, token(sessionA), 'A'),
    open(url, token(sessionB), 'B'),
    open(url, token(sessionC), 'C'),
    open(url, token(sessionD), 'D'),
    open(url, token(sessionE), 'E'),
  ]);
  t.after(() => [aSocket, bSocket, cSocket, dSocket, eSocket].forEach((socket) => socket.terminate()));

  const created = waitEvent(aSocket, 'conversation.created');
  const groupReply = await app.inject({
    method: 'POST',
    url: '/api/v1/groups',
    headers: header(sessionA),
    payload: { title: 'Isolation group' },
  });
  assert.equal(groupReply.statusCode, 201);
  const group = groupReply.json();
  assert.equal((await created).data.id, group.id);
  for (const member of [b, c]) {
    assert.equal(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${group.id}/members`,
        headers: header(sessionA),
        payload: { userId: member.id },
      })).statusCode,
      201,
    );
  }
  await waitEvent(cSocket, 'group.member_added', (event) => event.data.userId === c.id);
  const authored = await app.inject({
    method: 'POST',
    url: `/api/v1/conversations/${group.id}/messages`,
    headers: header(sessionC),
    payload: { clientMessageId: randomUUID(), content: 'c before removal' },
  });
  assert.equal(authored.statusCode, 201);
  const cMessage = authored.json();
  await waitEvent(cSocket, 'message.created', (event) => event.data.id === cMessage.id);
  await waitEvent(bSocket, 'message.created', (event) => event.data.id === cMessage.id);
  await flush(cSocket);
  await flush(dSocket);
  await flush(eSocket);

  const cMark = cSocket.chatEvents.length;
  const dMark = dSocket.chatEvents.length;
  const eMark = eSocket.chatEvents.length;
  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${group.id}/members/${c.id}`,
      headers: header(sessionA),
    })).statusCode,
    200,
  );
  const removalNotice = await waitEvent(
    cSocket,
    'group.member_removed',
    (event) => event.data.conversationId === group.id,
  );
  assert.equal(removalNotice.data.conversationId, group.id);
  await waitEvent(bSocket, 'group.member_removed', (event) => event.data.userId === c.id);
  await waitEvent(
    bSocket,
    'message.created',
    (event) => event.data.messageType === 'system' && event.data.content === 'A member was removed from the group',
  );
  await flush(cSocket);
  await flush(dSocket);
  await flush(eSocket);
  const cPrivate = leaked(cSocket, cMark);
  assert.equal(cPrivate.length, 1, JSON.stringify(cPrivate));
  assert.equal(cPrivate[0].event, 'group.member_removed');
  assert.equal(cPrivate[0].data.conversationId, group.id);
  assert.equal(leaked(dSocket, dMark).length, 0, JSON.stringify(leaked(dSocket, dMark)));
  assert.equal(leaked(eSocket, eMark).length, 0, JSON.stringify(leaked(eSocket, eMark)));
  const [membership] = await app.database.db
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, group.id), eq(conversationMembers.userId, c.id)));
  assert.ok(membership.leftAt);
  const isolatedAfterRemoval = [cSocket, dSocket, eSocket];

  const renamed = await assertFanout({
    action: async () => {
      const reply = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${group.id}`,
        headers: header(sessionA),
        payload: { title: 'Renamed isolation group' },
      });
      assert.equal(reply.statusCode, 200);
    },
    watcher: bSocket,
    event: 'conversation.updated',
    predicate: (event) => event.data.id === group.id && event.data.title === 'Renamed isolation group',
    isolated: isolatedAfterRemoval,
  });
  assert.equal(renamed.data.title, 'Renamed isolation group');

  const described = await assertFanout({
    action: async () => {
      const reply = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${group.id}`,
        headers: header(sessionA),
        payload: { description: 'Updated description' },
      });
      assert.equal(reply.statusCode, 200);
    },
    watcher: bSocket,
    event: 'conversation.updated',
    predicate: (event) => event.data.id === group.id && event.data.description === 'Updated description',
    isolated: isolatedAfterRemoval,
  });
  assert.equal(described.data.description, 'Updated description');

  const addMarks = {
    b: bSocket.chatEvents.length,
    e: eSocket.chatEvents.length,
    c: cSocket.chatEvents.length,
    d: dSocket.chatEvents.length,
  };
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${group.id}/members`,
      headers: header(sessionA),
      payload: { userId: e.id },
    })).statusCode,
    201,
  );
  assert.equal(
    (await waitNew(bSocket, addMarks.b, 'group.member_added', (event) => event.data.userId === e.id)).data.userId,
    e.id,
  );
  assert.equal(
    (await waitNew(eSocket, addMarks.e, 'group.member_added', (event) => event.data.userId === e.id)).data.userId,
    e.id,
  );
  await waitNew(bSocket, addMarks.b, 'message.created', (event) => event.data.content === 'A member was added to the group');
  await flush(cSocket);
  await flush(dSocket);
  assert.equal(leaked(cSocket, addMarks.c).length, 0, JSON.stringify(leaked(cSocket, addMarks.c)));
  assert.equal(leaked(dSocket, addMarks.d).length, 0, JSON.stringify(leaked(dSocket, addMarks.d)));

  const removeEMarks = {
    b: bSocket.chatEvents.length,
    c: cSocket.chatEvents.length,
    d: dSocket.chatEvents.length,
    e: eSocket.chatEvents.length,
  };
  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${group.id}/members/${e.id}`,
      headers: header(sessionA),
    })).statusCode,
    200,
  );
  await waitNew(bSocket, removeEMarks.b, 'group.member_removed', (event) => event.data.userId === e.id);
  await waitNew(eSocket, removeEMarks.e, 'group.member_removed', (event) => event.data.conversationId === group.id);
  await waitNew(
    bSocket,
    removeEMarks.b,
    'message.created',
    (event) => event.data.content === 'A member was removed from the group',
  );
  await flush(cSocket);
  await flush(dSocket);
  await flush(eSocket);
  assert.equal(leaked(cSocket, removeEMarks.c).length, 0, JSON.stringify(leaked(cSocket, removeEMarks.c)));
  assert.equal(leaked(dSocket, removeEMarks.d).length, 0, JSON.stringify(leaked(dSocket, removeEMarks.d)));
  const ePrivate = leaked(eSocket, removeEMarks.e);
  assert.equal(ePrivate.length, 1, JSON.stringify(ePrivate));
  assert.equal(ePrivate[0].event, 'group.member_removed');
  const isolated = [cSocket, dSocket, eSocket];

  const transferred = await assertFanout({
    action: async () => {
      const reply = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${group.id}/transfer-owner`,
        headers: header(sessionA),
        payload: { userId: b.id },
      });
      assert.equal(reply.statusCode, 200);
    },
    watcher: bSocket,
    event: 'group.owner_transferred',
    predicate: (event) => event.data.userId === b.id,
    isolated,
  });
  assert.equal(transferred.data.userId, b.id);
  await waitEvent(
    aSocket,
    'message.created',
    (event) => event.data.messageType === 'system' && event.data.content === 'Group ownership was transferred',
  );

  const textMessage = await assertFanout({
    action: async () => {
      const sent = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${group.id}/messages`,
        headers: header(sessionA),
        payload: { clientMessageId: randomUUID(), content: 'members only after removal' },
      });
      assert.equal(sent.statusCode, 201);
    },
    watcher: bSocket,
    event: 'message.created',
    predicate: (event) => event.data.content === 'members only after removal',
    isolated,
  });
  const textId = textMessage.data;
  assert.equal(textId.content, 'members only after removal');

  await assertFanout({
    action: async () => {
      const reply = await app.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${group.id}/members/${a.id}/role`,
        headers: header(sessionB),
        payload: { role: 'member' },
      });
      assert.equal(reply.statusCode, 200);
    },
    watcher: aSocket,
    event: 'message.created',
    predicate: (event) => event.data.messageType === 'system' && event.data.content === 'A member is now member',
    isolated,
  });
  assert.ok(aSocket.chatEvents.some((event) => event.event === 'group.member_updated' && event.data.userId === a.id));

  await assertFanout({
    action: () => {
      bSocket.send(JSON.stringify({ event: 'typing.start', data: { conversationId: group.id } }));
    },
    watcher: aSocket,
    event: 'typing.updated',
    predicate: (event) => event.data.userId === b.id && event.data.typing === true,
    isolated,
  });
  await assertFanout({
    action: () => {
      bSocket.send(JSON.stringify({ event: 'typing.stop', data: { conversationId: group.id } }));
    },
    watcher: aSocket,
    event: 'typing.updated',
    predicate: (event) => event.data.userId === b.id && event.data.typing === false,
    isolated,
  });
  await assertFanout({
    action: () => {
      bSocket.send(JSON.stringify({ event: 'message.delivered', data: { messageId: textId.id } }));
    },
    watcher: aSocket,
    event: 'receipt.updated',
    predicate: (event) => event.data.messageId === textId.id && event.data.delivered === true,
    isolated,
  });
  await assertFanout({
    action: () => {
      bSocket.send(JSON.stringify({
        event: 'conversation.read',
        data: { conversationId: group.id, sequenceNumber: textId.sequenceNumber },
      }));
    },
    watcher: aSocket,
    event: 'receipt.updated',
    predicate: (event) => event.data.userId === b.id && event.data.sequenceNumber === textId.sequenceNumber,
    isolated,
  });

  const snapshot = async () => {
    const [conversation] = await app.database.db.select().from(conversations).where(eq(conversations.id, group.id));
    const [memberRow] = await app.database.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, group.id), eq(conversationMembers.userId, c.id)));
    const [stored] = await app.database.db.select().from(messages).where(eq(messages.id, cMessage.id));
    const [{ receipts }] = await app.database.db
      .select({ receipts: sql`count(*)::int` })
      .from(messageReceipts)
      .where(eq(messageReceipts.messageId, textId.id));
    return {
      lastMessageSeq: conversation.lastMessageSeq,
      lastReadSeq: memberRow.lastReadSeq,
      content: stored.content,
      editedAt: stored.editedAt,
      deletedAt: stored.deletedAt,
      receipts,
    };
  };
  const before = await snapshot();
  const rejected = await Promise.all([
    app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${group.id}/messages`,
      headers: header(sessionC),
      payload: { clientMessageId: randomUUID(), content: 'should not persist' },
    }),
    app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${cMessage.id}`,
      headers: header(sessionC),
      payload: { content: 'edited after removal' },
    }),
    app.inject({ method: 'DELETE', url: `/api/v1/messages/${cMessage.id}`, headers: header(sessionC) }),
    app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${group.id}/messages?afterSeq=${cMessage.sequenceNumber}`,
      headers: header(sessionC),
    }),
    app.inject({ method: 'GET', url: `/api/v1/groups/${group.id}`, headers: header(sessionC) }),
    app.inject({ method: 'POST', url: `/api/v1/messages/${textId.id}/delivered`, headers: header(sessionC) }),
    app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${group.id}/read`,
      headers: header(sessionC),
      payload: { sequenceNumber: textId.sequenceNumber },
    }),
  ]);
  assert.deepEqual(
    rejected.map((reply) => reply.statusCode),
    [404, 404, 404, 404, 403, 404, 404],
  );
  const aTypingMark = aSocket.chatEvents.length;
  const forbidden = async (payload) => {
    const mark = cSocket.chatEvents.length;
    cSocket.send(JSON.stringify(payload));
    assert.equal(
      (await waitEvent(cSocket, 'error', (event) =>
        cSocket.chatEvents.slice(mark).some((item) => item.eventId === event.eventId && item.data?.code === 'FORBIDDEN_EVENT'),
      )).data.code,
      'FORBIDDEN_EVENT',
    );
  };
  await forbidden({ event: 'typing.start', data: { conversationId: group.id } });
  await forbidden({ event: 'typing.stop', data: { conversationId: group.id } });
  await forbidden({ event: 'message.delivered', data: { messageId: textId.id } });
  await forbidden({
    event: 'conversation.read',
    data: { conversationId: group.id, sequenceNumber: textId.sequenceNumber },
  });
  await flush(aSocket);
  await flush(bSocket);
  assert.equal(aSocket.chatEvents.slice(aTypingMark).filter((event) => PRIVATE_EVENTS.has(event.event)).length, 0);
  assert.deepEqual(await snapshot(), before);
  const history = await app.inject({
    method: 'GET',
    url: `/api/v1/conversations/${group.id}/messages?afterSeq=${cMessage.sequenceNumber}`,
    headers: header(sessionB),
  });
  assert.equal(history.statusCode, 200);
  assert.ok(history.json().data.some((row) => row.id === textId.id));
  assert.equal(
    dSocket.chatEvents.filter((event) => PRIVATE_EVENTS.has(event.event)).length,
    0,
    JSON.stringify(dSocket.chatEvents.filter((event) => PRIVATE_EVENTS.has(event.event))),
  );
});

test('Phase 3 Batch 2A: two-device group session-revocation cleanup', { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' }, async (t) => {
  const config = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testUrl,
    JWT_SECRET: 'group-revoke-secret-'.repeat(4),
  });
  const app = await buildApp({ config });
  t.after(() => app.close());
  await app.database.db.execute(
    sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
  );
  const password = 'Group-Revoke-Password-9!';
  const hash = await hashPassword(password);
  const [owner, member, observer] = await app.database.db
    .insert(users)
    .values(['rev-owner', 'rev-member', 'rev-observer'].map((username) => ({
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
  const [ownerSession, deviceA, deviceB, observerSession] = await Promise.all([
    login(owner, 'owner'),
    login(member, 'device-a'),
    login(member, 'device-b'),
    login(observer, 'observer'),
  ]);
  const token = (result) => accessToken(app, result.user, result.session);
  const header = (result) => ({ authorization: `Bearer ${token(result)}` });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const url = address.replace('http:', 'ws:') + '/api/v1/ws';
  const ownerSocket = await open(url, token(ownerSession), 'owner');
  const observerSocket = await open(url, token(observerSession), 'observer');
  const group = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: header(ownerSession),
      payload: { title: 'Revocation group' },
    })
  ).json();
  assert.equal(
    (await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${group.id}/members`,
      headers: header(ownerSession),
      payload: { userId: member.id },
    })).statusCode,
    201,
  );
  const socketA = await open(url, token(deviceA), 'device-a');
  await waitEvent(
    ownerSocket,
    'presence.updated',
    (event) => event.data.userId === member.id && event.data.online === true,
  );
  const onlineCount = ownerSocket.chatEvents.filter(
    (event) => event.event === 'presence.updated' && event.data.userId === member.id && event.data.online === true,
  ).length;
  const socketB = await open(url, token(deviceB), 'device-b');
  t.after(() => [ownerSocket, observerSocket, socketA, socketB].forEach((socket) => socket.terminate()));
  await flush(ownerSocket);
  assert.equal(
    ownerSocket.chatEvents.filter(
      (event) => event.event === 'presence.updated' && event.data.userId === member.id && event.data.online === true,
    ).length,
    onlineCount,
  );
  assert.equal(app.connections.user(member.id).size, 2);
  assert.equal(app.connections.session(deviceA.session.id).size, 1);
  assert.equal(app.connections.session(deviceB.session.id).size, 1);

  const firstA = waitEvent(socketA, 'message.created', (event) => event.data.content === 'both devices');
  const firstB = waitEvent(socketB, 'message.created', (event) => event.data.content === 'both devices');
  const first = await app.inject({
    method: 'POST',
    url: `/api/v1/conversations/${group.id}/messages`,
    headers: header(ownerSession),
    payload: { clientMessageId: randomUUID(), content: 'both devices' },
  });
  assert.equal(first.statusCode, 201);
  assert.equal((await firstA).data.id, first.json().id);
  assert.equal((await firstB).data.id, first.json().id);

  const aMessageMark = socketA.chatEvents.length;
  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/sessions/${deviceA.session.id}`,
      headers: header(deviceB),
    })).statusCode,
    200,
  );
  assert.equal(app.connections.session(deviceA.session.id).size, 0);
  assert.equal(app.connections.user(member.id).size, 1);
  assert.equal(socketB.readyState, WebSocket.OPEN);
  assert.equal(ownerSocket.readyState, WebSocket.OPEN);
  assert.equal(observerSocket.readyState, WebSocket.OPEN);
  assert.equal((await waitEvent(socketA, 'session.revoked')).event, 'session.revoked');
  const closedA = await socketA.closed;
  assert.equal(closedA.code, 4001);
  assert.equal(closedA.reason, 'session.revoked');
  const [revokedA] = await app.database.db.select().from(sessions).where(eq(sessions.id, deviceA.session.id));
  const [activeB] = await app.database.db.select().from(sessions).where(eq(sessions.id, deviceB.session.id));
  const [activeObserver] = await app.database.db.select().from(sessions).where(eq(sessions.id, observerSession.session.id));
  assert.ok(revokedA.revokedAt);
  assert.equal(activeB.revokedAt, null);
  assert.equal(activeObserver.revokedAt, null);

  const afterA = waitEvent(socketB, 'message.created', (event) => event.data.content === 'after device a revoked');
  const second = await app.inject({
    method: 'POST',
    url: `/api/v1/conversations/${group.id}/messages`,
    headers: header(ownerSession),
    payload: { clientMessageId: randomUUID(), content: 'after device a revoked' },
  });
  assert.equal(second.statusCode, 201);
  assert.equal((await afterA).data.id, second.json().id);
  await flush(ownerSocket);
  await flush(observerSocket);
  assert.equal(
    socketA.chatEvents.slice(aMessageMark).filter((event) => event.event === 'message.created').length,
    0,
    JSON.stringify(socketA.chatEvents.slice(aMessageMark)),
  );
  assert.equal(
    ownerSocket.chatEvents.filter(
      (event) => event.event === 'presence.updated' && event.data.userId === member.id && event.data.online === false,
    ).length,
    0,
  );
  assert.equal(observerSocket.chatEvents.filter((event) => PRIVATE_EVENTS.has(event.event)).length, 0);

  const bMark = socketB.chatEvents.length;
  assert.equal(
    (await app.inject({
      method: 'DELETE',
      url: `/api/v1/sessions/${deviceB.session.id}`,
      headers: header(deviceB),
    })).statusCode,
    200,
  );
  assert.equal(app.connections.session(deviceB.session.id).size, 0);
  assert.equal(app.connections.user(member.id).size, 0);
  assert.equal(app.connections.byUser.has(member.id), false);
  assert.equal(app.connections.bySession.has(deviceA.session.id), false);
  assert.equal(app.connections.bySession.has(deviceB.session.id), false);
  assert.equal((await waitEvent(socketB, 'session.revoked')).event, 'session.revoked');
  const closedB = await socketB.closed;
  assert.equal(closedB.code, 4001);
  assert.equal(closedB.reason, 'session.revoked');
  await waitEvent(
    ownerSocket,
    'presence.updated',
    (event) => event.data.userId === member.id && event.data.online === false,
  );
  assert.equal(
    ownerSocket.chatEvents.filter(
      (event) => event.event === 'presence.updated' && event.data.userId === member.id && event.data.online === true,
    ).length,
    1,
  );
  assert.equal(
    ownerSocket.chatEvents.filter(
      (event) => event.event === 'presence.updated' && event.data.userId === member.id && event.data.online === false,
    ).length,
    1,
  );
  assert.equal(ownerSocket.readyState, WebSocket.OPEN);
  assert.equal(observerSocket.readyState, WebSocket.OPEN);
  assert.equal(app.connections.user(owner.id).size, 1);
  assert.equal(app.connections.user(observer.id).size, 1);
  assert.equal(app.connections.byUser.size, 2);
  assert.equal(app.connections.bySession.size, 2);
  const [revokedB] = await app.database.db.select().from(sessions).where(eq(sessions.id, deviceB.session.id));
  const [stillObserver] = await app.database.db.select().from(sessions).where(eq(sessions.id, observerSession.session.id));
  assert.ok(revokedB.revokedAt);
  assert.equal(stillObserver.revokedAt, null);

  const ownerMark = ownerSocket.chatEvents.length;
  const future = waitEvent(ownerSocket, 'message.created', (event) => event.data.content === 'after both revoked');
  const third = await app.inject({
    method: 'POST',
    url: `/api/v1/conversations/${group.id}/messages`,
    headers: header(ownerSession),
    payload: { clientMessageId: randomUUID(), content: 'after both revoked' },
  });
  assert.equal(third.statusCode, 201);
  assert.equal((await future).data.id, third.json().id);
  await flush(observerSocket);
  assert.equal(socketA.readyState, WebSocket.CLOSED);
  assert.equal(socketB.readyState, WebSocket.CLOSED);
  assert.equal(socketA.chatEvents.slice(aMessageMark).filter((event) => event.event === 'message.created').length, 0);
  assert.equal(socketB.chatEvents.slice(bMark).filter((event) => event.event === 'message.created').length, 0);
  assert.equal(observerSocket.chatEvents.filter((event) => PRIVATE_EVENTS.has(event.event)).length, 0);
  assert.equal(observerSocket.chatEvents.filter((event) => event.event === 'presence.updated').length, 0);
  assert.ok(ownerSocket.chatEvents.slice(ownerMark).some((event) => event.data?.content === 'after both revoked'));
  assert.equal(app.connections.user(member.id).size, 0);
  assert.equal(app.connections.byUser.size, 2);
});
