import { AppError } from '../../utils/app-error.js';

export function callsController(app) {
  const service = app.calls;
  return {
    capabilities: async () => service.capabilities(),

    iceConfig: async (request) => service.iceConfig(request.auth.userId),

    create: async (request, reply) => {
      const { call, existing } = await service.create(
        request.auth.userId,
        request.auth.sessionId,
        request.body.calleeId,
      );
      const peers = await service.loadPeers(call);
      reply.code(existing ? 200 : 201);
      return service.present(call, request.auth.userId, peers);
    },

    get: async (request) => service.get(request.params.id, request.auth.userId),

    accept: async (request) => {
      const row = await service.accept(request.params.id, request.auth.userId, request.auth.sessionId);
      const peers = await service.loadPeers(row);
      return service.present(row, request.auth.userId, peers);
    },

    reject: async (request) => {
      const row = await service.reject(request.params.id, request.auth.userId, request.auth.sessionId);
      const peers = await service.loadPeers(row);
      return service.present(row, request.auth.userId, peers);
    },

    cancel: async (request) => {
      const row = await service.cancel(request.params.id, request.auth.userId, request.auth.sessionId);
      const peers = await service.loadPeers(row);
      return service.present(row, request.auth.userId, peers);
    },

    busy: async (request) => {
      const row = await service.busy(request.params.id, request.auth.userId, request.auth.sessionId);
      const peers = await service.loadPeers(row);
      return service.present(row, request.auth.userId, peers);
    },

    connected: async (request) => {
      const row = await service.connected(request.params.id, request.auth.userId, request.auth.sessionId);
      const peers = await service.loadPeers(row);
      return service.present(row, request.auth.userId, peers);
    },

    end: async (request) => {
      const row = await service.end(request.params.id, request.auth.userId, request.auth.sessionId);
      const peers = await service.loadPeers(row);
      return service.present(row, request.auth.userId, peers);
    },
  };
}

export function assertCallsEnabled(config) {
  if (!config.callsEnabled) throw new AppError('Voice calling is not enabled', 503, 'CALLS_DISABLED');
}
