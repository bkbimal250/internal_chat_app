import { conversationService } from '../modules/conversations/conversations.service.js';
import { receiptsService } from '../modules/receipts/receipts.service.js';
import { envelope } from './connection-manager.js';
export function events(app, c) {
  let n = 0,
    at = Date.now(),
    iceN = 0,
    iceAt = Date.now();
  return async (raw) => {
    const uuid = (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const text = raw.toString();
    const isCall = /"event"\s*:\s*"call\./.test(text.slice(0, 240));
    if (text.length > (isCall ? 32768 : 8192)) return c.socket.close(1009, 'payload too large');
    if (isCall) {
      if (++iceN > 240 && Date.now() - iceAt < 60000) return c.socket.close(1008, 'rate limit');
      if (Date.now() - iceAt >= 60000) {
        iceN = 0;
        iceAt = Date.now();
      }
    } else {
      if (++n > 60 && Date.now() - at < 60000) return c.socket.close(1008, 'rate limit');
      if (Date.now() - at >= 60000) {
        n = 0;
        at = Date.now();
      }
    }
    let x;
    try {
      x = JSON.parse(text);
    } catch {
      return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
    }
    if (!x || typeof x !== 'object' || typeof x.event !== 'string' || (x.data !== undefined && typeof x.data !== 'object')) {
      return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
    }
    const callEvents = [
      'call.offer',
      'call.answer',
      'call.ice_candidate',
      'call.ringing',
    ];
    if (
      ![
        'ping',
        'typing.start',
        'typing.stop',
        'conversation.read',
        'message.delivered',
        ...callEvents,
      ].includes(x.event)
    )
      return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
    if (x.event.startsWith('call.')) {
      try {
        if (!app.calls.capabilities().enabled) {
          return c.socket.send(JSON.stringify(envelope('error', { code: 'CALLS_DISABLED', callId: x.data?.callId })));
        }
        if (x.event === 'call.ringing') {
          if (!uuid(x.data?.callId)) return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
          await app.calls.ringingAck(c, x.data.callId);
          return;
        }
        const kind = x.event === 'call.ice_candidate' ? 'ice' : x.event.replace('call.', '');
        await app.calls.signal(c, kind, x.data || {});
      } catch (error) {
        return c.socket.send(
          JSON.stringify(envelope('error', { code: error.code || 'FORBIDDEN_EVENT', callId: x.data?.callId })),
        );
      }
      return;
    }
    if (x.event === 'ping')
      return c.socket.send(JSON.stringify(envelope('pong', {})));
    if (x.event === 'conversation.read') {
      if (!uuid(x.data?.conversationId) || !Number.isInteger(x.data.sequenceNumber) || x.data.sequenceNumber < 0)
        return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
      try {
        await receiptsService(app).read(x.data.conversationId, c.userId, x.data.sequenceNumber);
        await app.broadcaster.conversation(x.data.conversationId, 'receipt.updated', {
          conversationId: x.data.conversationId,
          userId: c.userId,
          sequenceNumber: x.data.sequenceNumber,
        });
      } catch {
        return c.socket.send(JSON.stringify(envelope('error', { code: 'FORBIDDEN_EVENT' })));
      }
    }
    if (x.event === 'message.delivered') {
      if (!uuid(x.data?.messageId)) return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
      try {
        const message = await receiptsService(app).delivered(x.data.messageId, c.userId);
        await app.broadcaster.conversation(message.conversationId, 'receipt.updated', {
          conversationId: message.conversationId,
          userId: c.userId,
          messageId: message.id,
          delivered: true,
        });
      } catch {
        return c.socket.send(JSON.stringify(envelope('error', { code: 'FORBIDDEN_EVENT' })));
      }
    }
    if (x.event.startsWith('typing.')) {
      if (!uuid(x.data?.conversationId)) return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
      try {
        await conversationService(app).assertMember(x.data.conversationId, c.userId);
        await app.broadcaster.conversation(
          x.data.conversationId,
          'typing.updated',
          {
            conversationId: x.data.conversationId,
            userId: c.userId,
            typing: x.event === 'typing.start',
          },
          { excludeUserId: c.userId },
        );
      } catch {
        return c.socket.send(JSON.stringify(envelope('error', { code: 'FORBIDDEN_EVENT' })));
      }
    }
  };
}
