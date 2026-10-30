import { conversationService } from './conversations.service.js';
import { receiptsService } from '../receipts/receipts.service.js';
export const conversationsController = (app) => {
  const s = conversationService(app);
  const receipts = receiptsService(app);
  return {
    direct: async (r, q) => {
      const x = await s.direct(r.auth.userId, r.body.userId);
      q.code(x.existing ? 200 : 201);
      if (!x.existing) {
        await app.broadcaster.conversation(x.id, 'conversation.created', { id: x.id, type: 'direct' });
        await app.broadcaster.presence(r.auth.userId, true);
        if (app.connections.user(r.body.userId).size > 0) {
          await app.broadcaster.presence(r.body.userId, true);
        }
      }
      return x;
    },
    list: (r) => s.list(r.auth.userId, r.query.cursor, r.query.limit ?? 30),
    details: (r) => s.details(r.params.id, r.auth.userId),
    read: async (r) => {
      await receipts.read(r.params.id, r.auth.userId, r.body.sequenceNumber);
      await app.broadcaster.conversation(r.params.id, 'receipt.updated', {
        conversationId: r.params.id,
        userId: r.auth.userId,
        sequenceNumber: r.body.sequenceNumber,
      });
      return { success: true };
    },
  };
};
