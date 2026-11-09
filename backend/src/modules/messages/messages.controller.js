import { messagesService } from './messages.service.js';
import { attachmentsService } from '../attachments/attachments.service.js';
import { notifyNewMessage } from '../notify/message-notify.js';
export const messagesController = (app, config) => {
  const s = messagesService(app);
  const files = attachmentsService(app, config);
  const emit = async (kind, m, userId) => {
    const presented = await s.present(m, userId);
    await app.broadcaster.conversation(presented.conversationId, kind, presented);
    return presented;
  };
  const created = async (presented, duplicate) => {
    if (duplicate) return presented;
    await app.broadcaster.conversation(presented.conversationId, 'message.created', presented);
    await notifyNewMessage(app, presented).catch(() => {});
    return presented;
  };
  return {
    get: (r) => s.get(r.params.id, r.auth.userId),
    list: (r) => s.list(r.params.id, r.auth.userId, r.query.afterSeq, r.query.limit ?? 50),
    sync: (r) => s.sync(r.params.id, r.auth.userId, r.query.afterChangeSeq, r.query.limit ?? 50),
    create: async (r, q) => {
      const x = await s.create(r.params.id, r.auth.userId, r.body);
      const presented = await s.present(x.message, r.auth.userId);
      q.code(x.duplicate ? 200 : 201);
      return created(presented, x.duplicate);
    },
    edit: async (r) => emit('message.updated', await s.edit(r.params.id, r.auth.userId, r.body.content), r.auth.userId),
    remove: async (r) => emit('message.deleted', await s.remove(r.params.id, r.auth.userId), r.auth.userId),
    hide: async (r) => {
      const result = await s.hide(r.params.id, r.auth.userId);
      await app.broadcaster.user(r.auth.userId, 'message.hidden', result);
      return result;
    },
    react: async (r) => emit('message.updated', await s.react(r.params.id, r.auth.userId, r.body.emoji), r.auth.userId),
    forward: async (r, q) => {
      const source = await s.get(r.params.id, r.auth.userId);
      if (source.attachment) {
        const forwarded = await files.forward(r.params.id, r.auth.userId, {
          conversationId: r.body.conversationId,
          clientMessageId: r.body.clientMessageId,
        });
        const presented = await s.present(forwarded, r.auth.userId);
        q.code(forwarded.duplicate ? 200 : 201);
        return created(presented, forwarded.duplicate);
      }
      const x = await s.create(r.body.conversationId, r.auth.userId, {
        clientMessageId: r.body.clientMessageId,
        content: r.body.content,
        forwardedFromMessageId: r.params.id,
      });
      const presented = await s.present(x.message, r.auth.userId);
      q.code(x.duplicate ? 200 : 201);
      return created(presented, x.duplicate);
    },
  };
};
