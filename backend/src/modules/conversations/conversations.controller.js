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
    list: (r) =>
      s.list(r.auth.userId, r.query.cursor, r.query.limit ?? 30, {
        archived: r.query.archived === true || r.query.archived === 'true',
      }),
    details: (r) => s.details(r.params.id, r.auth.userId),
    hide: (r) => s.hide(r.params.id, r.auth.userId),
    hideMany: async (r, q) => {
      const body = await s.hideMany(r.auth.userId, r.body.conversationIds);
      if (body.failed.length && !body.hidden.length) q.code(400);
      return body;
    },
    pin: (r) => s.pin(r.params.id, r.auth.userId, r.body.pinned),
    pinMany: async (r, q) => {
      const body = await s.pinMany(r.auth.userId, r.body.conversationIds, r.body.pinned);
      if (body.failed.length && !body.pinned.length) q.code(400);
      return body;
    },
    archive: (r) => s.archive(r.params.id, r.auth.userId, r.body.archived),
    archiveMany: async (r, q) => {
      const body = await s.archiveMany(r.auth.userId, r.body.conversationIds, r.body.archived);
      if (body.failed.length && !body.archived.length) q.code(400);
      return body;
    },
    unread: (r) => s.unread(r.params.id, r.auth.userId),
    unreadMany: async (r, q) => {
      const body = await s.unreadMany(r.auth.userId, r.body.conversationIds);
      if (body.failed.length && !body.unread.length) q.code(400);
      return body;
    },
    readMany: async (r, q) => {
      const body = await s.readMany(r.auth.userId, r.body.conversationIds);
      for (const row of body.read) {
        await app.broadcaster.conversation(row.id, 'receipt.updated', {
          conversationId: row.id,
          userId: r.auth.userId,
          sequenceNumber: row.lastReadSeq,
        });
      }
      if (body.failed.length && !body.read.length) q.code(400);
      return body;
    },
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
