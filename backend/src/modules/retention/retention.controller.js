import { retentionService } from './retention.service.js';

export function retentionController(app, config) {
  const service = retentionService(app, config);
  const actor = (request) => ({ userId: request.auth.userId, sessionId: request.auth.sessionId, ip: request.ip });
  return {
    policy: () => service.publicPolicy(),
    preview: () => service.preview(),
    jobs: () => service.jobs(),
    conversation: (request) => service.conversationRetention(request.params.id, request.auth.userId),
    notifications: (request) => service.listNotifications(request.auth.userId),
    readNotification: (request) => service.markRead(request.params.id, request.auth.userId),
    updatePolicy: (request) => service.updatePolicy(request.auth.userId, request.body, actor(request)),
    activate: (request) => service.activateCleanup(request.auth.userId, actor(request)),
    pause: (request) => service.pauseCleanup(actor(request)),
    hold: (request) =>
      service.placeHold(request.body.conversationId, request.auth.userId, request.body.reason, actor(request)),
    releaseHold: (request) => service.releaseHold(request.params.id, actor(request)),
    exportChat: async (request, reply) => {
      const row = await service.requestExport(request.params.id, request.auth.userId, actor(request));
      reply.code(202);
      return row;
    },
    exportStatus: (request) => service.exportStatus(request.params.id, request.auth.userId),
  };
}
