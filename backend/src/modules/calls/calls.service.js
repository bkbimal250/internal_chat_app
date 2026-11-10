import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { envelope } from '../../websocket/connection-manager.js';
import { buildIceConfig } from './ice-config.js';
import {
  ACTIVE_CALL_STATUSES,
  eventForStatus,
  isTerminalCallStatus,
  nextCallStatus,
  signalingAllowed,
} from './calls.state.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNAL_KINDS = new Set(['offer', 'answer', 'ice']);
const SDP_MAX = 24000;
const ICE_MAX = 2048;
const PURGE_MS = 15000;

function disabled() {
  throw new AppError('Voice calling is not enabled', 503, 'CALLS_DISABLED');
}

function presentPeer(user) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.displayName,
    fullName: user.fullName || user.displayName,
    username: user.username,
    hasProfilePhoto: Boolean(user.profilePhotoKey),
    photoVersion: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt,
  };
}

function publicCall(row, viewerId, peers = {}) {
  const incoming = row.calleeId === viewerId;
  return {
    id: row.id,
    callerId: row.callerId,
    calleeId: row.calleeId,
    callType: row.callType,
    status: row.status,
    createdAt: row.createdAt,
    direction: incoming ? 'incoming' : 'outgoing',
    peer: presentPeer(incoming ? peers.caller : peers.callee) ?? {
      id: incoming ? row.callerId : row.calleeId,
    },
  };
}

function assertUuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new AppError(`Invalid ${field}`, 400, 'VALIDATION_ERROR');
  }
}

export function callsService(app, config) {
  const db = app.database.db;
  const byId = new Map();

  function ensureEnabled() {
    if (!config.callsEnabled) disabled();
  }

  function emit(userId, event, data, { onlySessionId, exceptSessionId } = {}) {
    const text = JSON.stringify(envelope(event, data));
    for (const connection of app.connections.user(userId)) {
      if (onlySessionId && connection.sessionId !== onlySessionId) continue;
      if (exceptSessionId && connection.sessionId === exceptSessionId) continue;
      if (connection.socket.readyState === 1) connection.socket.send(text);
    }
  }

  function emitParticipants(row, event, extra = {}) {
    const payload = {
      callId: row.id,
      callerId: row.callerId,
      calleeId: row.calleeId,
      status: row.status,
      ...extra,
    };
    emit(row.callerId, event, payload);
    emit(row.calleeId, event, payload);
  }

  async function loadPeers(row) {
    const [caller, callee] = await Promise.all([
      db.select().from(users).where(eq(users.id, row.callerId)).then((rows) => rows[0]),
      db.select().from(users).where(eq(users.id, row.calleeId)).then((rows) => rows[0]),
    ]);
    return { caller, callee };
  }

  function getRow(id) {
    return byId.get(id) ?? null;
  }

  function requireParticipant(id, userId) {
    const row = getRow(id);
    if (!row) throw new AppError('Call not found', 404, 'NOT_FOUND');
    if (row.callerId !== userId && row.calleeId !== userId) {
      throw new AppError('Not a participant in this call', 403, 'FORBIDDEN');
    }
    return row;
  }

  function findActiveForUser(userId) {
    for (const row of byId.values()) {
      if (!ACTIVE_CALL_STATUSES.includes(row.status)) continue;
      if (row.callerId === userId || row.calleeId === userId) return row;
    }
    return null;
  }

  function findActiveBetween(a, b) {
    for (const row of byId.values()) {
      if (!ACTIVE_CALL_STATUSES.includes(row.status)) continue;
      if ((row.callerId === a && row.calleeId === b) || (row.callerId === b && row.calleeId === a)) return row;
    }
    return null;
  }

  function apply(row, action, { sessionId } = {}) {
    const next = nextCallStatus(row.status, action);
    if (!next.ok) throw new AppError('Call cannot change state', 409, 'INVALID_CALL_STATE');
    if (next.idempotent) return row;
    row.status = next.status;
    row.updatedAt = new Date();
    if (isTerminalCallStatus(next.status)) {
      row.purgeAt = new Date(Date.now() + PURGE_MS);
    }
    if (action === 'accept') {
      row.acceptedSessionId = sessionId;
      row.expiresAt = new Date(Date.now() + config.callConnectTimeoutSeconds * 1000);
    }
    if (action === 'connected') {
      row.expiresAt = null;
    }
    byId.set(row.id, row);
    return row;
  }

  async function notifyInvite(row, caller) {
    const invite = {
      callId: row.id,
      callerId: row.callerId,
      calleeId: row.calleeId,
      callType: row.callType,
      status: row.status,
      createdAt: row.createdAt,
      caller: presentPeer(caller),
    };
    emit(row.calleeId, 'call.invite', invite);
    emit(row.callerId, 'call.ringing', { callId: row.id, status: 'ringing', calleeId: row.calleeId });
    if (app.push?.enabled) {
      await app.push.sendToUser(row.calleeId, {
        title: caller.displayName || 'MiChat',
        body: 'Incoming voice call',
        data: {
          type: 'incoming_call',
          callId: row.id,
          callerId: row.callerId,
          callerName: caller.displayName || 'MiChat',
        },
        android: { channelId: 'michat_calls', tag: row.id, visibility: 'public' },
        apns: { category: 'INCOMING_CALL', threadId: row.id },
        collapseKey: `call-${row.id}`,
      });
    }
  }

  return {
    capabilities() {
      const { turnConfigured } = buildIceConfig(config, 'anonymous');
      return {
        enabled: Boolean(config.callsEnabled),
        callType: 'audio',
        recorded: false,
        persisted: false,
        turnConfigured,
        timeoutSeconds: config.callTimeoutSeconds,
      };
    },

    iceConfig(userId) {
      ensureEnabled();
      return buildIceConfig(config, userId);
    },

    async create(userId, sessionId, calleeId) {
      ensureEnabled();
      assertUuid(calleeId, 'calleeId');
      if (calleeId === userId) throw new AppError('Cannot call yourself', 400, 'INVALID_PARTICIPANT');
      const [callee] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, calleeId), eq(users.status, 'active'), isNull(users.deletedAt)));
      if (!callee) throw new AppError('Employee not found', 404, 'NOT_FOUND');
      const existing = findActiveBetween(userId, calleeId);
      if (existing) {
        if (existing.calleeId === userId || existing.callerId === userId) return { call: existing, existing: true };
      }
      const calleeBusy = findActiveForUser(calleeId);
      if (calleeBusy && calleeBusy.callerId !== userId && calleeBusy.calleeId !== userId) {
        throw new AppError('User is on another call', 409, 'CALL_BUSY');
      }
      const callerBusy = findActiveForUser(userId);
      if (callerBusy) throw new AppError('You already have an active call', 409, 'CALL_IN_PROGRESS');
      const now = new Date();
      const row = {
        id: randomUUID(),
        callerId: userId,
        calleeId,
        callerSessionId: sessionId,
        acceptedSessionId: null,
        callType: 'audio',
        status: 'ringing',
        expiresAt: new Date(now.getTime() + config.callTimeoutSeconds * 1000),
        createdAt: now,
        updatedAt: now,
        purgeAt: null,
      };
      byId.set(row.id, row);
      const [caller] = await db.select().from(users).where(eq(users.id, userId));
      await notifyInvite(row, caller);
      return { call: row, existing: false };
    },

    async get(id, userId) {
      ensureEnabled();
      const row = requireParticipant(id, userId);
      const peers = await loadPeers(row);
      return publicCall(row, userId, peers);
    },

    async accept(id, userId, sessionId) {
      ensureEnabled();
      const row = requireParticipant(id, userId);
      if (row.calleeId !== userId) throw new AppError('Only the callee can accept', 403, 'FORBIDDEN');
      if (row.status === 'connecting' || row.status === 'connected') {
        if (row.acceptedSessionId && row.acceptedSessionId !== sessionId) {
          throw new AppError('Call was answered on another device', 409, 'CALL_OWNED_BY_OTHER_DEVICE');
        }
        return row;
      }
      const updated = apply(row, 'accept', { sessionId });
      emitParticipants(updated, 'call.accept', { acceptedSessionId: sessionId });
      emit(row.calleeId, 'call.accept', { callId: row.id, status: 'connecting', acceptedSessionId: sessionId }, {
        exceptSessionId: sessionId,
      });
      return updated;
    },

    async reject(id, userId, sessionId) {
      ensureEnabled();
      const row = requireParticipant(id, userId);
      if (row.calleeId !== userId) throw new AppError('Only the callee can reject', 403, 'FORBIDDEN');
      const updated = apply(row, 'reject', { sessionId });
      emitParticipants(updated, 'call.reject');
      return updated;
    },

    async cancel(id, userId, sessionId) {
      ensureEnabled();
      const row = requireParticipant(id, userId);
      if (row.callerId !== userId) throw new AppError('Only the caller can cancel', 403, 'FORBIDDEN');
      const updated = apply(row, 'cancel', { sessionId });
      emitParticipants(updated, 'call.cancel');
      return updated;
    },

    async busy(id, userId, sessionId) {
      ensureEnabled();
      const row = requireParticipant(id, userId);
      if (row.calleeId !== userId) throw new AppError('Only the callee can mark busy', 403, 'FORBIDDEN');
      const updated = apply(row, 'busy', { sessionId });
      emitParticipants(updated, 'call.busy');
      return updated;
    },

    async connected(id, userId, sessionId) {
      ensureEnabled();
      const row = requireParticipant(id, userId);
      if (row.callerSessionId !== sessionId && row.acceptedSessionId !== sessionId) {
        throw new AppError('This device does not own the call', 403, 'FORBIDDEN');
      }
      const already = row.status === 'connected';
      const updated = apply(row, 'connected', { sessionId });
      if (!already) emitParticipants(updated, 'call.connected');
      return updated;
    },

    async end(id, userId, sessionId) {
      ensureEnabled();
      const row = requireParticipant(id, userId);
      const action = row.status === 'connecting' || row.status === 'connected' ? 'end' : row.callerId === userId ? 'cancel' : 'reject';
      const updated = apply(row, action, { sessionId });
      emitParticipants(updated, eventForStatus(updated.status, action));
      return updated;
    },

    async signal(connection, kind, data) {
      ensureEnabled();
      if (!SIGNAL_KINDS.has(kind)) {
        throw new AppError('Unknown signaling event', 400, 'INVALID_EVENT');
      }
      const callId = data?.callId;
      assertUuid(callId, 'callId');
      const row = requireParticipant(callId, connection.userId);
      if (!signalingAllowed(row.status, kind === 'ice' ? 'ice' : kind)) {
        throw new AppError('Signaling is not allowed in this call state', 409, 'INVALID_CALL_STATE');
      }
      const fromCaller = connection.sessionId === row.callerSessionId;
      const fromAccepted = row.acceptedSessionId && connection.sessionId === row.acceptedSessionId;
      if (kind === 'offer' && !fromCaller) throw new AppError('Only the caller can send an offer', 403, 'FORBIDDEN');
      if (kind === 'answer' && !fromAccepted) throw new AppError('Only the accepted device can answer', 403, 'FORBIDDEN');
      if (kind === 'ice' && !fromCaller && !fromAccepted) {
        throw new AppError('This device cannot send ICE candidates', 403, 'FORBIDDEN');
      }
      let payload;
      if (kind === 'ice') {
        const candidate = data?.candidate;
        if (!candidate || typeof candidate !== 'object') throw new AppError('ICE candidate required', 400, 'INVALID_EVENT');
        const sdpMid = typeof candidate.sdpMid === 'string' ? candidate.sdpMid.slice(0, 64) : null;
        const candidateStr = typeof candidate.candidate === 'string' ? candidate.candidate : '';
        if (candidateStr.length > ICE_MAX) throw new AppError('ICE candidate too large', 400, 'INVALID_EVENT');
        payload = {
          callId,
          candidate: {
            candidate: candidateStr,
            sdpMid,
            sdpMLineIndex: Number.isInteger(candidate.sdpMLineIndex) ? candidate.sdpMLineIndex : 0,
          },
        };
      } else {
        const sdp = typeof data?.sdp === 'string' ? data.sdp : '';
        if (!sdp || sdp.length > SDP_MAX) throw new AppError('SDP is invalid', 400, 'INVALID_EVENT');
        payload = { callId, sdp, type: kind };
      }
      const targetUserId = fromCaller ? row.calleeId : row.callerId;
      const targetSession = fromCaller ? row.acceptedSessionId : row.callerSessionId;
      const event = kind === 'ice' ? 'call.ice_candidate' : `call.${kind}`;
      if (kind === 'offer' && !row.acceptedSessionId) {
        emit(row.calleeId, event, payload);
      } else if (targetSession) {
        emit(targetUserId, event, payload, { onlySessionId: targetSession });
      } else {
        emit(targetUserId, event, payload);
      }
      return { ok: true };
    },

    async ringingAck(connection, callId) {
      ensureEnabled();
      const row = requireParticipant(callId, connection.userId);
      if (row.calleeId !== connection.userId) throw new AppError('Only the callee can ring', 403, 'FORBIDDEN');
      if (row.status !== 'ringing' && row.status !== 'initiating') return { ok: true };
      const updated = row.status === 'initiating' ? apply(row, 'ring', { sessionId: connection.sessionId }) : row;
      emit(row.callerId, 'call.ringing', { callId: row.id, status: 'ringing' });
      return { ok: true, status: updated.status };
    },

    async expireStale() {
      if (!config.callsEnabled) return { expired: 0 };
      const now = new Date();
      let expired = 0;
      for (const row of [...byId.values()]) {
        if (row.purgeAt && row.purgeAt <= now) {
          byId.delete(row.id);
          continue;
        }
        if (!row.expiresAt || row.expiresAt > now) continue;
        if (row.status === 'initiating' || row.status === 'ringing') {
          const updated = apply(row, 'timeout');
          emitParticipants(updated, 'call.timeout');
          expired += 1;
        } else if (row.status === 'connecting') {
          const updated = apply(row, 'fail');
          emitParticipants(updated, 'call.end');
          expired += 1;
        }
      }
      return { expired };
    },

    async expireForTest(id) {
      if (config.nodeEnv !== 'test') return { expired: 0 };
      const row = byId.get(id);
      if (row) row.expiresAt = new Date(0);
      return this.expireStale();
    },

    async endOwnedBySessions(sessionIds) {
      if (!config.callsEnabled || !sessionIds?.length) return { ended: 0 };
      const wanted = new Set(sessionIds);
      let ended = 0;
      for (const row of [...byId.values()]) {
        if (!ACTIVE_CALL_STATUSES.includes(row.status)) continue;
        if (!wanted.has(row.callerSessionId) && !wanted.has(row.acceptedSessionId)) continue;
        const updated = apply(row, row.status === 'connected' || row.status === 'connecting' ? 'fail' : 'cancel');
        emitParticipants(updated, 'call.end');
        ended += 1;
      }
      return { ended };
    },

    present: publicCall,
    loadPeers,
  };
}
