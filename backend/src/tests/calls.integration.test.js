import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';
import { sql } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { loadEnv } from '../config/env.js';
import { users } from '../database/schema/index.js';
import { hashPassword } from '../services/password.service.js';
import { authService } from '../modules/auth/auth.service.js';
import { accessToken } from '../services/token.service.js';

const testUrl = process.env.TEST_DATABASE_URL;
const enabled = testUrl && new URL(testUrl).pathname.endsWith('_test');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate) => {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await pause(20);
  }
  assert.fail('Timed out waiting for condition');
};
const open = async (url, token) => {
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  socket.events = [];
  socket.on('message', (raw) => socket.events.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await until(() => socket.events.some((event) => event.event === 'connection.ready'));
  return socket;
};

test(
  'voice calling REST, signaling and authorization without persistent history',
  { skip: !enabled && 'Set TEST_DATABASE_URL ending in _test' },
  async (t) => {
    const config = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testUrl,
      JWT_SECRET: 'calls-integration-secret-'.repeat(4),
      CALLS_ENABLED: 'true',
      CALL_TIMEOUT_SECONDS: '10',
      TURN_URLS: 'turn:turn.test:3478',
      TURN_SECRET: 'coturn-hmac-secret',
    });
    const app = await buildApp({ config });
    t.after(() => app.close());
    await app.database.db.execute(
      sql`truncate table audit_logs, consumed_refresh_tokens, sessions, devices, users restart identity cascade`,
    );
    const hash = await hashPassword('Calls-Password-9!');
    const [caller, callee, stranger] = await app.database.db
      .insert(users)
      .values([
        { username: 'caller', displayName: 'Caller', passwordHash: hash, mustChangePassword: false },
        { username: 'callee', displayName: 'Callee', passwordHash: hash, mustChangePassword: false },
        { username: 'stranger', displayName: 'Stranger', passwordHash: hash, mustChangePassword: false },
      ])
      .returning();
    const auth = authService(app, config);
    const login = (user, device) =>
      auth.login(
        {
          username: user.username,
          password: 'Calls-Password-9!',
          clientType: 'native',
          platform: 'android',
          deviceName: device,
        },
        { ip: '127.0.0.1' },
      );
    const callerA = await login(caller, 'caller-a');
    const calleeA = await login(callee, 'callee-a');
    const calleeB = await login(callee, 'callee-b');
    const strangerA = await login(stranger, 'stranger-a');
    const token = (result) => accessToken(app, result.user, result.session);
    const bearer = (result) => ({ authorization: `Bearer ${token(result)}` });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const wsUrl = address.replace('http:', 'ws:') + '/api/v1/ws';

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/calls/capabilities', headers: bearer(callerA) });
    assert.equal(capabilities.statusCode, 200);
    assert.equal(capabilities.json().enabled, true);
    const ice = await app.inject({ method: 'GET', url: '/api/v1/calls/ice-config', headers: bearer(callerA) });
    assert.equal(ice.statusCode, 200);
    assert.equal(ice.json().turnConfigured, true);
    assert.equal(JSON.stringify(ice.json()).includes('coturn-hmac-secret'), false);

    const calleeSocket = await open(wsUrl, token(calleeA));
    const calleeSecond = await open(wsUrl, token(calleeB));
    const callerSocket = await open(wsUrl, token(callerA));
    t.after(() => [calleeSocket, calleeSecond, callerSocket].forEach((socket) => socket.terminate()));

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/calls',
      headers: bearer(callerA),
      payload: { calleeId: callee.id },
    });
    assert.equal(created.statusCode, 201);
    const call = created.json();
    assert.equal(call.status, 'ringing');
    assert.equal(call.direction, 'outgoing');
    assert.equal(call.peer.displayName, 'Callee');
    assert.equal(call.peer.phoneE164, undefined);
    await until(() => calleeSocket.events.some((event) => event.event === 'call.invite' && event.data.callId === call.id));
    await until(() => calleeSecond.events.some((event) => event.event === 'call.invite'));
    assert.equal(
      callerSocket.events.some((event) => event.event === 'call.ringing'),
      false,
    );
    calleeSocket.send(JSON.stringify({ event: 'call.ringing', data: { callId: call.id } }));
    await until(() => callerSocket.events.some((event) => event.event === 'call.ringing' && event.data.callId === call.id));

    const strangerJoin = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${call.id}/accept`,
      headers: bearer(strangerA),
    });
    assert.equal(strangerJoin.statusCode, 403);

    const unauthorizedSignal = await new Promise((resolve) => {
      const strangerSocket = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${token(strangerA)}` } });
      strangerSocket.on('message', (raw) => {
        const event = JSON.parse(raw.toString());
        if (event.event === 'connection.ready') {
          strangerSocket.send(JSON.stringify({ event: 'call.offer', data: { callId: call.id, sdp: 'v=0' } }));
        }
        if (event.event === 'error') {
          strangerSocket.terminate();
          resolve(event);
        }
      });
    });
    assert.equal(unauthorizedSignal.data.code, 'FORBIDDEN');

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${call.id}/accept`,
      headers: bearer(calleeA),
    });
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().status, 'connecting');
    await pause(40);
    assert.equal(
      calleeSocket.events.some((event) => event.event === 'call.accept'),
      false,
    );
    await until(() => callerSocket.events.some((event) => event.event === 'call.accept' && event.data.callId === call.id));
    await until(() => calleeSecond.events.some((event) => event.event === 'call.accept'));
    const secondAccept = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${call.id}/accept`,
      headers: bearer(calleeB),
    });
    assert.equal(secondAccept.statusCode, 409);
    assert.equal(secondAccept.json().error.code, 'CALL_OWNED_BY_OTHER_DEVICE');

    callerSocket.send(JSON.stringify({ event: 'call.offer', data: { callId: call.id, sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0' } }));
    await until(() =>
      calleeSocket.events.some((event) => event.event === 'call.offer' && event.data.callId === call.id),
    );
    assert.equal(
      calleeSecond.events.some((event) => event.event === 'call.offer'),
      false,
    );

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${call.id}/accept`,
      headers: bearer(calleeA),
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().status, 'connecting');

    const connected = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${call.id}/connected`,
      headers: bearer(callerA),
    });
    assert.equal(connected.statusCode, 200);
    assert.equal(connected.json().status, 'connected');

    const ended = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${call.id}/end`,
      headers: bearer(callerA),
    });
    assert.equal(ended.statusCode, 200);
    assert.equal(ended.json().status, 'ended');
    const endAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${call.id}/end`,
      headers: bearer(callerA),
    });
    assert.equal(endAgain.statusCode, 200);

    const rejectCall = await app.inject({
      method: 'POST',
      url: '/api/v1/calls',
      headers: bearer(callerA),
      payload: { calleeId: callee.id },
    });
    assert.equal(rejectCall.statusCode, 201);
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${rejectCall.json().id}/reject`,
      headers: bearer(calleeA),
    });
    assert.equal(rejected.json().status, 'rejected');

    const cancelCall = await app.inject({
      method: 'POST',
      url: '/api/v1/calls',
      headers: bearer(callerA),
      payload: { calleeId: callee.id },
    });
    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${cancelCall.json().id}/cancel`,
      headers: bearer(callerA),
    });
    assert.equal(cancelled.json().status, 'cancelled');

    const busyCall = await app.inject({
      method: 'POST',
      url: '/api/v1/calls',
      headers: bearer(callerA),
      payload: { calleeId: callee.id },
    });
    const busy = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${busyCall.json().id}/busy`,
      headers: bearer(calleeA),
    });
    assert.equal(busy.json().status, 'busy');

    const timeoutCall = await app.inject({
      method: 'POST',
      url: '/api/v1/calls',
      headers: bearer(callerA),
      payload: { calleeId: callee.id },
    });
    const expired = await app.calls.expireForTest(timeoutCall.json().id);
    assert.ok(expired.expired >= 1);
    const missed = await app.inject({
      method: 'GET',
      url: `/api/v1/calls/${timeoutCall.json().id}`,
      headers: bearer(callerA),
    });
    assert.equal(missed.json().status, 'missed');
    assert.equal(missed.json().durationSeconds, undefined);

    calleeSocket.terminate();
    calleeSecond.terminate();
    const replayCall = await app.inject({
      method: 'POST',
      url: '/api/v1/calls',
      headers: bearer(callerA),
      payload: { calleeId: callee.id },
    });
    assert.equal(replayCall.statusCode, 201);
    const replayId = replayCall.json().id;
    callerSocket.send(JSON.stringify({ event: 'call.offer', data: { callId: replayId, sdp: 'v=0\r\no=- 2 1 IN IP4 0.0.0.0' } }));
    callerSocket.send(
      JSON.stringify({
        event: 'call.ice_candidate',
        data: { callId: replayId, candidate: { candidate: 'candidate:1 1 UDP 1 1.1.1.1 9 typ relay', sdpMid: '0', sdpMLineIndex: 0 } },
      }),
    );
    await pause(40);
    const lateCallee = await open(wsUrl, token(calleeA));
    t.after(() => lateCallee.terminate());
    assert.equal(
      lateCallee.events.some((event) => event.event === 'call.offer' && event.data.callId === replayId),
      false,
    );
    const replayAccept = await app.inject({
      method: 'POST',
      url: `/api/v1/calls/${replayId}/accept`,
      headers: bearer(calleeA),
    });
    assert.equal(replayAccept.statusCode, 200);
    await until(() =>
      lateCallee.events.some((event) => event.event === 'call.offer' && event.data.callId === replayId),
    );
    await until(() =>
      lateCallee.events.some((event) => event.event === 'call.ice_candidate' && event.data.callId === replayId),
    );

    const history = await app.inject({ method: 'GET', url: '/api/v1/calls/history', headers: bearer(callerA) });
    assert.ok(history.statusCode >= 400);

    const disabledApp = await buildApp({
      config: loadEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: testUrl,
        JWT_SECRET: 'calls-integration-secret-'.repeat(4),
        CALLS_ENABLED: 'false',
      }),
    });
    t.after(() => disabledApp.close());
    const disabledCreate = await disabledApp.inject({
      method: 'POST',
      url: '/api/v1/calls',
      headers: bearer(callerA),
      payload: { calleeId: callee.id },
    });
    assert.equal(disabledCreate.statusCode, 503);
    assert.equal(disabledCreate.json().error.code, 'CALLS_DISABLED');
    const disabledCaps = await disabledApp.inject({
      method: 'GET',
      url: '/api/v1/calls/capabilities',
      headers: bearer(callerA),
    });
    assert.equal(disabledCaps.json().enabled, false);
    const disabledIce = await disabledApp.inject({
      method: 'GET',
      url: '/api/v1/calls/ice-config',
      headers: bearer(callerA),
    });
    assert.equal(disabledIce.statusCode, 503);
    assert.equal(disabledIce.json().error.code, 'CALLS_DISABLED');
  },
);
