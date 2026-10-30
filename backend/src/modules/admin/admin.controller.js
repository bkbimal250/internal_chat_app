import { adminService } from './admin.service.js';
import { publicUser } from '../auth/auth.repository.js';
export function adminController(app) {
  const service = adminService(app);
  return {
    list: async (req) => {
      const result = await service.list(req.query);
      return { ...result, data: result.data.map(publicUser) };
    },
    get: async (req) => publicUser(await service.get(req.params.id)),
    create: async (req, reply) => {
      const r = await service.create(req.body, req.auth);
      reply.code(201);
      return { user: publicUser(r.user), temporaryPassword: r.temporaryPassword };
    },
    update: async (req) => publicUser(await service.update(req.params.id, req.body, req.auth)),
    suspend: async (req) =>
      publicUser(await service.setStatus(req.params.id, 'suspended', req.auth)),
    reactivate: async (req) =>
      publicUser(await service.setStatus(req.params.id, 'active', req.auth)),
    reset: async (req) => {
      const r = await service.resetPassword(req.params.id, req.auth);
      return { user: publicUser(r.user), temporaryPassword: r.temporaryPassword };
    },
    revoke: async (req) => ({ revoked: await service.revokeAll(req.params.id, req.auth) }),
    audit: async (req) => service.audit(req.query),
  };
}
