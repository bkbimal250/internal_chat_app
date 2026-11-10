export const ACTIVE_CALL_STATUSES = Object.freeze([
  'initiating',
  'ringing',
  'connecting',
  'connected',
]);

export const TERMINAL_CALL_STATUSES = Object.freeze([
  'ended',
  'missed',
  'rejected',
  'busy',
  'failed',
  'cancelled',
]);

export const CALL_ACTIONS = Object.freeze({
  RING: 'ring',
  ACCEPT: 'accept',
  REJECT: 'reject',
  CANCEL: 'cancel',
  BUSY: 'busy',
  TIMEOUT: 'timeout',
  CONNECTED: 'connected',
  END: 'end',
  FAIL: 'fail',
});

const TRANSITIONS = Object.freeze({
  initiating: {
    ring: 'ringing',
    cancel: 'cancelled',
    busy: 'busy',
    timeout: 'missed',
    fail: 'failed',
  },
  ringing: {
    accept: 'connecting',
    reject: 'rejected',
    cancel: 'cancelled',
    timeout: 'missed',
    busy: 'busy',
    fail: 'failed',
  },
  connecting: {
    connected: 'connected',
    end: 'ended',
    fail: 'failed',
    cancel: 'cancelled',
  },
  connected: {
    end: 'ended',
    fail: 'failed',
  },
});

export function isActiveCallStatus(status) {
  return ACTIVE_CALL_STATUSES.includes(status);
}

export function isTerminalCallStatus(status) {
  return TERMINAL_CALL_STATUSES.includes(status);
}

export function isIdempotentCallAction(status, action) {
  if (action === 'accept' && (status === 'connecting' || status === 'connected')) return true;
  if (action === 'connected' && status === 'connected') return true;
  if (action === 'reject' && status === 'rejected') return true;
  if (action === 'cancel' && status === 'cancelled') return true;
  if (action === 'busy' && status === 'busy') return true;
  if (action === 'timeout' && status === 'missed') return true;
  if (action === 'end' && isTerminalCallStatus(status)) return true;
  if (action === 'fail' && (status === 'failed' || isTerminalCallStatus(status))) return true;
  if (action === 'ring' && status === 'ringing') return true;
  return false;
}

export function nextCallStatus(status, action) {
  if (isIdempotentCallAction(status, action)) {
    return { ok: true, status, idempotent: true };
  }
  const next = TRANSITIONS[status]?.[action];
  if (!next) {
    return { ok: false, status, code: 'INVALID_CALL_STATE' };
  }
  return { ok: true, status: next, idempotent: false };
}

export function signalingAllowed(status, kind) {
  if (kind === 'offer') return status === 'ringing' || status === 'connecting' || status === 'connected';
  if (kind === 'answer') return status === 'connecting' || status === 'connected';
  if (kind === 'ice') return status === 'ringing' || status === 'connecting' || status === 'connected';
  return false;
}

export function eventForStatus(status, action) {
  if (action === 'ring') return 'call.ringing';
  if (action === 'accept') return 'call.accept';
  if (action === 'reject') return 'call.reject';
  if (action === 'cancel') return 'call.cancel';
  if (action === 'busy') return 'call.busy';
  if (action === 'timeout') return 'call.timeout';
  if (action === 'connected') return 'call.connected';
  if (action === 'end') return 'call.end';
  if (action === 'fail') return 'call.end';
  return `call.${status}`;
}
