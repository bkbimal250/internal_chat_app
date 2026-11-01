import { publicUser } from '../auth/auth.repository.js';
import { usersService } from './users.service.js';
import { profilePhotoService } from '../../services/profile-photo.service.js';

export function usersController(app, config) {
  const service = usersService(app, config);
  const photos = profilePhotoService(app, config);
  const present = async (user) =>
    publicUser({
      ...user,
      profilePhotoUrl: user.profilePhotoKey ? await photos.url(user).catch(() => null) : null,
    });
  const directory = async (req) => {
    const result = await service.directory(req.query);
    return {
      ...result,
      data: result.data.map((u) => ({
        id: u.id,
        employeeCode: u.employeeCode,
        username: u.username,
        displayName: u.displayName,
        fullName: u.fullName || u.displayName,
        hasProfilePhoto: Boolean(u.profilePhotoKey),
        photoVersion: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : u.updatedAt,
        phoneE164: u.phoneE164 ?? null,
        createdAt: u.createdAt,
      })),
    };
  };
  return {
    me: (req) => present(req.auth.user),
    updateMe: async (req) => present(await service.updateMe(req.auth.userId, req.body)),
    directory,
    public: async (req) => {
      const full = await present(await service.public(req.params.id));
      return {
        ...full,
        email: null,
        phoneE164: null,
        phoneVerifiedAt: null,
        address: null,
        mustChangePassword: false,
      };
    },
    initPhoto: async (req) => service.initPhoto(req.auth.userId, req.body.mimeType),
    completePhoto: async (req) =>
      present(await service.completePhoto(req.auth.userId, req.body.key, req.body.mimeType)),
    removePhoto: async (req) => present(await service.removePhoto(req.auth.userId)),
    photoUrl: async (req) => {
      const user = await service.public(req.params.id);
      return { url: await service.photoUrl(user) };
    },
  };
}
