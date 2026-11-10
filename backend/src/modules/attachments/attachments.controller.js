import { attachmentsService } from './attachments.service.js';
import { notifyNewMessage } from '../notify/message-notify.js';

export const attachmentsController = (app, config) => {
  const service = attachmentsService(app, config);
  return {
    init: async (request, reply) => {
      const result = await service.init(request.params.id, request.auth.userId, request.body);
      reply.code(201);
      return result;
    },
    signParts: (request) => service.signParts(request.params.id, request.auth.userId, request.body),
    listParts: (request) => service.listUploadedParts(request.params.id, request.auth.userId),
    finalize: async (request, reply) => {
      const message = await service.finalize(request.params.id, request.auth.userId, request.body);
      if (!message.duplicate) {
        await app.broadcaster.conversation(message.conversationId, 'message.created', message);
        await notifyNewMessage(app, message).catch(() => {});
      }
      reply.code(message.duplicate ? 200 : 201);
      return message;
    },
    completeBatch: async (request, reply) => {
      const message = await service.completeBatch(request.params.id, request.auth.userId, request.body);
      if (!message.duplicate) {
        await app.broadcaster.conversation(message.conversationId, 'message.created', message);
        await notifyNewMessage(app, message).catch(() => {});
      }
      reply.code(message.duplicate ? 200 : 201);
      return message;
    },
    download: (request) =>
      service.downloadUrl(request.params.id, request.auth.userId, { download: request.query.download === true }),
    zip: async (request, reply) => {
      try {
        request.raw?.setTimeout?.(0);
      } catch {
        /* light-my-request's setTimeout requires a listener */
      }
      try {
        reply.raw?.setTimeout?.(0);
      } catch {
        /* inject mocks are not sockets */
      }
      const prepared = await service.openZipStream(request.params.id, request.auth.userId, request.body.ids);
      reply.type('application/zip');
      reply.header('Content-Disposition', prepared.contentDisposition);
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Archive-Name', encodeURIComponent(prepared.archiveName));
      reply.header('X-Archive-Bytes', String(prepared.totalBytes));
      const sending = reply.send(prepared.output);
      prepared.start().catch((error) => {
        if (!prepared.output.destroyed) prepared.output.destroy(error);
      });
      return sending;
    },
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
