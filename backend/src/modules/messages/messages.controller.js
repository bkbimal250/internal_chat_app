import { messagesService } from './messages.service.js';
import { attachmentsService } from '../attachments/attachments.service.js';
export const messagesController = (app) => {
  const s = messagesService(app);
  const files = attachmentsService(app);
  const emit = async (kind, m) => {
    await app.broadcaster.conversation(m.conversationId, kind, m);
    return m;
  };
  return {
    get: (r) => s.get(r.params.id, r.auth.userId),
    list: (r) => s.list(r.params.id, r.auth.userId, r.query.afterSeq, r.query.limit ?? 50),
    sync: (r) => s.sync(r.params.id, r.auth.userId, r.query.afterChangeSeq, r.query.limit ?? 50),
    create: async (r, q) => {
      const x = await s.create(r.params.id, r.auth.userId, r.body);
      if (!x.duplicate) await app.broadcaster.conversation(r.params.id, 'message.created', x.message);
      q.code(x.duplicate ? 200 : 201);
      return x.message;
    },
    edit: async (r) =>
      emit('message.updated', await s.edit(r.params.id, r.auth.userId, r.body.content)),
    remove: async (r) => emit('message.deleted', await s.remove(r.params.id, r.auth.userId)),
    forward: async (r, q) => {
      const source = await s.get(r.params.id, r.auth.userId);
      if (source.attachment) {
        const forwarded = await files.forward(r.params.id, r.auth.userId, {
          conversationId: r.body.conversationId,
          clientMessageId: r.body.clientMessageId,
        });
        if (!forwarded.duplicate) {
          await app.broadcaster.conversation(r.body.conversationId, 'message.created', forwarded);
        }
        q.code(forwarded.duplicate ? 200 : 201);
        return forwarded;
      }
      const x = await s.create(r.body.conversationId, r.auth.userId, {
        clientMessageId: r.body.clientMessageId,
        content: r.body.content,
        forwardedFromMessageId: r.params.id,
      });
      if (!x.duplicate) await app.broadcaster.conversation(r.body.conversationId, 'message.created', x.message);
      q.code(x.duplicate ? 200 : 201);
      return x.message;
    },
  };
};
