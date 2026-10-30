import { attachmentsService } from './attachments.service.js';

export const attachmentsController = (app, config) => {
  const service = attachmentsService(app, config);
  return {
    init: async (request, reply) => {
      const result = await service.init(request.params.id, request.auth.userId, request.body);
      reply.code(201);
      return result;
    },
    finalize: async (request, reply) => {
      const message = await service.finalize(request.params.id, request.auth.userId, request.body);
      if (!message.duplicate) {
        await app.broadcaster.conversation(message.conversationId, 'message.created', message);
      }
      reply.code(message.duplicate ? 200 : 201);
      return message;
    },
    download: (request) => service.downloadUrl(request.params.id, request.auth.userId),
    cancel: (request) => service.cancel(request.params.id, request.auth.userId),
    remove: async (request) => {
      const message = await service.remove(request.params.id, request.auth.userId);
      if (message) await app.broadcaster.conversation(message.conversationId, 'message.deleted', message);
      return { success: true };
    },
    destroy: async (request) => {
      const message = await service.destroy(request.params.id, request.auth.userId);
      if (message) await app.broadcaster.conversation(message.conversationId, 'message.deleted', message);
      return { success: true };
    },
  };
};
