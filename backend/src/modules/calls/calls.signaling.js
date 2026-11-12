const ICE_BUFFER_MAX = 64;

export function createCallSignaling() {
  return { offer: null, answer: null, iceFromCaller: [], iceFromCallee: [] };
}

export function bufferCallSignal(signaling, kind, fromCaller, payload, maxIce = ICE_BUFFER_MAX) {
  const next = signaling || createCallSignaling();
  if (kind === 'offer') {
    next.offer = payload;
    next.iceFromCaller = [];
    return next;
  }
  if (kind === 'answer') {
    next.answer = payload;
    next.iceFromCallee = [];
    return next;
  }
  if (kind === 'ice') {
    const list = fromCaller ? next.iceFromCaller : next.iceFromCallee;
    if (list.length < maxIce) list.push(payload);
  }
  return next;
}

export function signalingReplayForAccepted(signaling) {
  if (!signaling?.offer) return [];
  const events = [{ event: 'call.offer', payload: signaling.offer }];
  for (const ice of signaling.iceFromCaller || []) {
    events.push({ event: 'call.ice_candidate', payload: ice });
  }
  return events;
}
