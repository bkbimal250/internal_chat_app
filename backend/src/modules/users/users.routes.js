import { usersController } from './users.controller.js';
import {
  apiSchema,
  DirectoryUser,
  IdParams,
  PageQuery,
  PhotoCompleteBody,
  PhotoInitBody,
  PhotoInitResponse,
  PhotoUrlResponse,
  UpdateMe,
  User,
  pageOf,
} from './users.schema.js';
export default async function userRoutes(app, config) {
  const c = usersController(app, config);
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
  app.post(
    '/api/v1/users/me/photo',
    {
      schema: apiSchema('Users', 'Start profile photo upload', PhotoInitResponse, {
        body: PhotoInitBody,
      }),
      preHandler: app.authenticate,
    },
    c.initPhoto,
  );
  app.post(
    '/api/v1/users/me/photo/complete',
    {
      schema: apiSchema('Users', 'Finalize profile photo upload', User, {
        body: PhotoCompleteBody,
      }),
      preHandler: app.authenticate,
    },
    c.completePhoto,
  );
  app.delete(
    '/api/v1/users/me/photo',
    { schema: apiSchema('Users', 'Remove own profile photo', User), preHandler: app.authenticate },
    c.removePhoto,
  );
  app.get(
    '/api/v1/users/:id/photo-url',
    {
      schema: apiSchema('Users', 'Signed profile photo URL', PhotoUrlResponse, { params: IdParams }),
      preHandler: app.authenticate,
    },
    c.photoUrl,
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
