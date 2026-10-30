import { conversationService } from '../modules/conversations/conversations.service.js';
import { receiptsService } from '../modules/receipts/receipts.service.js';
import { envelope } from './connection-manager.js';
export function events(app, c) {
  let n = 0,
    at = Date.now();
  return async (raw) => {
    const uuid = (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (raw.length > 8192) return c.socket.close(1009, 'payload too large');
    if (++n > 60 && Date.now() - at < 60000) return c.socket.close(1008, 'rate limit');
    if (Date.now() - at >= 60000) {
      n = 0;
      at = Date.now();
    }
    let x;
    try {
      x = JSON.parse(raw.toString());
    } catch {
      return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
    }
    if (!x || typeof x !== 'object' || typeof x.event !== 'string' || (x.data !== undefined && typeof x.data !== 'object')) {
      return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
    }
    if (
      !['ping', 'typing.start', 'typing.stop', 'conversation.read', 'message.delivered'].includes(
        x.event,
      )
    )
      return c.socket.send(JSON.stringify(envelope('error', { code: 'INVALID_EVENT' })));
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
        await app.broadcaster.conversation(x.data.conversationId, 'typing.updated', {
          conversationId: x.data.conversationId,
          userId: c.userId,
          typing: x.event === 'typing.start',
        });
      } catch {
        return c.socket.send(JSON.stringify(envelope('error', { code: 'FORBIDDEN_EVENT' })));
      }
    }
  };
}
