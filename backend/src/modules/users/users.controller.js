import { publicUser } from '../auth/auth.repository.js';
import { usersService } from './users.service.js';
export function usersController(app) {
  const service = usersService(app);
  const directory = async (req) => {
    const result = await service.directory(req.query);
    return {
      ...result,
      data: result.data.map((u) => ({
        id: u.id,
        employeeCode: u.employeeCode,
        username: u.username,
        displayName: u.displayName,
        createdAt: u.createdAt,
      })),
    };
  };
  return {
    me: (req) => publicUser(req.auth.user),
    updateMe: async (req) => publicUser(await service.updateMe(req.auth.userId, req.body)),
    directory,
    public: async (req) => publicUser(await service.public(req.params.id)),
  };
}
