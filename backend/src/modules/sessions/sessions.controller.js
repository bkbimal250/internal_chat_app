import { sessionsService } from './sessions.service.js';
export function sessionsController(app) {
  const service = sessionsService(app);
  return {
    list: async (req) =>
      (await service.list(req.auth.userId)).map((s) => ({
        ...s,
        current: s.id === req.auth.sessionId,
      })),
    revoke: async (req) => {
      await service.revoke(req.auth.userId, req.params.id, req.auth);
      return { success: true };
    },
  };
}
