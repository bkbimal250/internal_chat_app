import { usersController } from './users.controller.js';
import {
  apiSchema,
  DirectoryUser,
  IdParams,
  PageQuery,
  UpdateMe,
  User,
  pageOf,
} from './users.schema.js';
export default async function userRoutes(app) {
  const c = usersController(app);
  app.get(
    '/api/v1/users',
    {
      schema: apiSchema('Users', 'Company employee directory', pageOf(DirectoryUser), {
        querystring: PageQuery,
      }),
      preHandler: app.authenticate,
    },
    c.directory,
  );
  app.get(
    '/api/v1/users/me',
    { schema: apiSchema('Users', 'Own profile', User), preHandler: app.authenticateRestricted },
    c.me,
  );
  app.patch(
    '/api/v1/users/me',
    {
      schema: apiSchema('Users', 'Update own permitted profile', User, { body: UpdateMe }),
      preHandler: app.authenticate,
    },
    c.updateMe,
  );
  app.get(
    '/api/v1/users/:id',
    {
      schema: apiSchema('Users', 'Employee public profile', User, { params: IdParams }),
      preHandler: app.authenticate,
    },
    c.public,
  );
}
