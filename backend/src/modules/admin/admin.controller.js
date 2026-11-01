import { adminService } from './admin.service.js';
import { publicUser } from '../auth/auth.repository.js';
import { profilePhotoService } from '../../services/profile-photo.service.js';

export function adminController(app, config) {
  const service = adminService(app, config);
  const photos = profilePhotoService(app, config);
  const present = async (user) =>
    publicUser({
      ...user,
      profilePhotoUrl: user.profilePhotoKey ? await photos.url(user).catch(() => null) : null,
    });
  return {
    list: async (req) => {
      const result = await service.list(req.query);
      return { ...result, data: await Promise.all(result.data.map(present)) };
    },
    get: async (req) => present(await service.get(req.params.id)),
    create: async (req, reply) => {
      const r = await service.create(req.body, req.auth);
      reply.code(201);
      return { user: await present(r.user), temporaryPassword: r.temporaryPassword };
    },
    update: async (req) => present(await service.update(req.params.id, req.body, req.auth)),
    suspend: async (req) =>
      present(await service.setStatus(req.params.id, 'suspended', req.auth)),
    reactivate: async (req) =>
      present(await service.setStatus(req.params.id, 'active', req.auth)),
    reset: async (req) => {
      const r = await service.resetPassword(req.params.id, req.body ?? {}, req.auth);
      return { user: await present(r.user), temporaryPassword: r.temporaryPassword };
    },
    revoke: async (req) => ({ revoked: await service.revokeAll(req.params.id, req.auth) }),
    remove: async (req) => service.remove(req.params.id, req.auth),
    audit: async (req) => service.audit(req.query),
    initPhoto: async (req) => service.initPhoto(req.params.id, req.body.mimeType),
    completePhoto: async (req) =>
      present(await service.completePhoto(req.params.id, req.body.key, req.body.mimeType, req.auth)),
    removePhoto: async (req) => present(await service.removePhoto(req.params.id, req.auth)),
  };
}
