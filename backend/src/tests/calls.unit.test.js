import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env.js';
import { buildIceConfig, turnCredentials } from '../modules/calls/ice-config.js';
import { callsService } from '../modules/calls/calls.service.js';
import {
  bufferCallSignal,
  createCallSignaling,
  signalingReplayForAccepted,
} from '../modules/calls/calls.signaling.js';
import {
  isIdempotentCallAction,
  nextCallStatus,
  signalingAllowed,
} from '../modules/calls/calls.state.js';

test('call state machine accepts valid transitions and rejects invalid ones', () => {
  assert.equal(nextCallStatus('initiating', 'ring').status, 'ringing');
  assert.equal(nextCallStatus('ringing', 'accept').status, 'connecting');
  assert.equal(nextCallStatus('connecting', 'connected').status, 'connected');
  assert.equal(nextCallStatus('connected', 'end').status, 'ended');
  assert.equal(nextCallStatus('ringing', 'reject').status, 'rejected');
  assert.equal(nextCallStatus('ringing', 'cancel').status, 'cancelled');
  assert.equal(nextCallStatus('ringing', 'timeout').status, 'missed');
  assert.equal(nextCallStatus('ringing', 'busy').status, 'busy');
  assert.equal(nextCallStatus('connected', 'accept').ok, true);
  assert.equal(nextCallStatus('connected', 'accept').idempotent, true);
  assert.equal(nextCallStatus('ended', 'end').ok, true);
  assert.equal(nextCallStatus('ended', 'end').idempotent, true);
  assert.equal(nextCallStatus('connected', 'reject').ok, false);
});

test('duplicate accept and end events are idempotent', () => {
  assert.equal(isIdempotentCallAction('connecting', 'accept'), true);
  assert.equal(isIdempotentCallAction('connected', 'accept'), true);
  assert.equal(isIdempotentCallAction('rejected', 'reject'), true);
  assert.equal(isIdempotentCallAction('ended', 'end'), true);
  assert.equal(isIdempotentCallAction('ringing', 'end'), false);
});

test('early offer and caller ICE are replayed only to the accepted device', () => {
  const signaling = createCallSignaling();
  bufferCallSignal(signaling, 'offer', true, { callId: 'c1', sdp: 'offer-sdp' });
  bufferCallSignal(signaling, 'ice', true, { callId: 'c1', candidate: { candidate: 'typ host', sdpMid: '0', sdpMLineIndex: 0 } });
  bufferCallSignal(signaling, 'ice', true, { callId: 'c1', candidate: { candidate: 'typ relay', sdpMid: '0', sdpMLineIndex: 0 } });
  const replay = signalingReplayForAccepted(signaling);
  assert.equal(replay[0].event, 'call.offer');
  assert.equal(replay[0].payload.sdp, 'offer-sdp');
  assert.equal(replay.length, 3);
  assert.equal(replay.filter((item) => item.event === 'call.ice_candidate').length, 2);
  const replaced = bufferCallSignal(signaling, 'offer', true, { callId: 'c1', sdp: 'second-offer' });
  assert.equal(replaced.offer.sdp, 'second-offer');
  assert.equal(replaced.iceFromCaller.length, 0);
  assert.deepEqual(signalingReplayForAccepted(createCallSignaling()), []);
});

test('signaling is limited to live call states', () => {
  assert.equal(signalingAllowed('ringing', 'offer'), true);
  assert.equal(signalingAllowed('connecting', 'answer'), true);
  assert.equal(signalingAllowed('connected', 'ice'), true);
  assert.equal(signalingAllowed('ended', 'offer'), false);
  assert.equal(signalingAllowed('rejected', 'ice'), false);
});

test('TURN credentials are time-limited HMAC values and never embed the secret', () => {
  const secret = 'unit-test-turn-secret';
  const creds = turnCredentials(secret, 'user-1', Date.parse('2026-01-01T00:00:00.000Z'), 3600);
  assert.match(creds.username, /^1767229200:user-1$/);
  assert.equal(creds.credential.includes(secret), false);
  const config = {
    stunUrls: 'stun:stun.example:3478',
    turnUrls: 'turn:turn.example:3478?transport=udp',
    turnSecret: secret,
  };
  const ice = buildIceConfig(config, 'user-1', Date.parse('2026-01-01T00:00:00.000Z'));
  assert.equal(ice.turnConfigured, true);
  assert.equal(JSON.stringify(ice).includes(secret), false);
  assert.ok(ice.iceServers.some((server) => Array.isArray(server.urls) && server.urls[0].startsWith('turn:')));
});

test('ICE config falls back to STUN when TURN is not configured', () => {
  const ice = buildIceConfig({ stunUrls: '', turnUrls: '', turnSecret: '' }, 'user-1');
  assert.equal(ice.turnConfigured, false);
  assert.ok(ice.iceServers.length >= 1);
  assert.ok(JSON.stringify(ice.iceServers).includes('stun:'));
});

test('call schema is not persisted in Postgres', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const index = readFileSync(join(root, 'database/schema/index.js'), 'utf8');
  assert.doesNotMatch(index, /calls\.js/);
  assert.doesNotMatch(index, /from '\.\/calls'/);
});

test('capabilities advertise live audio only with no recording or persistence', () => {
  const service = callsService(
    { database: { db: {} }, connections: { user: () => [] } },
    { callsEnabled: true, stunUrls: '', turnUrls: '', turnSecret: '' },
  );
  const caps = service.capabilities();
  assert.equal(caps.enabled, true);
  assert.equal(caps.callType, 'audio');
  assert.equal(caps.recorded, false);
  assert.equal(caps.persisted, false);
});

test('calling is enabled in development and disabled in production unless flagged', () => {
  const secret = 'foundation-test-only-secret-'.repeat(4);
  const dev = loadEnv({
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'development',
  });
  assert.equal(dev.callsEnabled, true);
  assert.equal(dev.chatAttachmentsEnabled, true);
  const testEnv = loadEnv({
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'test',
  });
  assert.equal(testEnv.callsEnabled, true);
  assert.equal(testEnv.chatAttachmentsEnabled, true);
  const disabledTest = loadEnv({
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'test',
    CHAT_ATTACHMENTS_ENABLED: 'false',
    CALLS_ENABLED: 'false',
  });
  assert.equal(disabledTest.chatAttachmentsEnabled, false);
  assert.equal(disabledTest.callsEnabled, false);
  const productionEnv = {
    JWT_SECRET: secret,
    DATABASE_URL: 'postgresql://chat:secret@postgres:5432/company_chat',
    NODE_ENV: 'production',
    SMS_USERNAME: 'user',
    SMS_API_KEY: 'key',
    SMS_TEMPLATE_ID: 'tmpl',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secret-key',
    CORS_ORIGINS: 'https://web.michat.in',
  };
  const production = loadEnv(productionEnv);
  assert.equal(production.callsEnabled, false);
  assert.equal(production.chatAttachmentsEnabled, false);
  assert.equal(
    loadEnv({
      ...productionEnv,
      CALLS_ENABLED: 'true',
      TURN_URLS: 'turn:turn.example:3478',
      TURN_SECRET: 'x',
    }).callsEnabled,
    true,
  );
  assert.equal(loadEnv({ ...productionEnv, CHAT_ATTACHMENTS_ENABLED: 'true' }).chatAttachmentsEnabled, true);
  assert.equal(loadEnv({ ...productionEnv, CHAT_ATTACHMENTS_ENABLED: 'false' }).chatAttachmentsEnabled, false);
  assert.equal(loadEnv({ ...productionEnv, CALLS_ENABLED: 'false' }).callsEnabled, false);
});
