import { Type as T } from '@sinclair/typebox';
import { adminController } from './admin.controller.js';
import {
  apiSchema,
  CreatedUser,
  CreateUserBody,
  IdParams,
  PageQuery,
  UpdateUserBody,
  User,
  Audit,
  pageOf,
} from './admin.schema.js';
import { object } from '../auth/auth.schema.js';
export default async function adminRoutes(app) {
  const c = adminController(app);
  const guard = [app.authenticate, app.adminOnly];
  app.post(
    '/api/v1/admin/users',
    {
      schema: apiSchema(
        'Admin',
        'Create employee',
        CreatedUser,
        { body: CreateUserBody },
        true,
        201,
      ),
      preHandler: guard,
    },
    c.create,
  );
  app.get(
    '/api/v1/admin/users',
    {
      schema: apiSchema('Admin', 'List employees', pageOf(User), { querystring: PageQuery }),
      preHandler: guard,
    },
    c.list,
  );
  app.get(
    '/api/v1/admin/users/:id',
    {
      schema: apiSchema('Admin', 'Employee details', User, { params: IdParams }),
      preHandler: guard,
    },
    c.get,
  );
  app.patch(
    '/api/v1/admin/users/:id',
    {
      schema: apiSchema('Admin', 'Update employee profile', User, {
        params: IdParams,
        body: UpdateUserBody,
      }),
      preHandler: guard,
    },
    c.update,
  );
  app.post(
    '/api/v1/admin/users/:id/suspend',
    {
      schema: apiSchema('Admin', 'Suspend employee', User, { params: IdParams }),
      preHandler: guard,
    },
    c.suspend,
  );
  app.post(
    '/api/v1/admin/users/:id/reactivate',
    {
      schema: apiSchema('Admin', 'Reactivate employee', User, { params: IdParams }),
      preHandler: guard,
    },
    c.reactivate,
  );
  app.post(
    '/api/v1/admin/users/:id/reset-password',
    {
      schema: apiSchema('Admin', 'Reset employee password', CreatedUser, { params: IdParams }),
      preHandler: guard,
    },
    c.reset,
  );
  app.delete(
    '/api/v1/admin/users/:id/sessions',
    {
      schema: apiSchema('Admin', 'Revoke all employee sessions', object({ revoked: T.Integer() }), {
        params: IdParams,
      }),
      preHandler: guard,
    },
    c.revoke,
  );
  app.get(
    '/api/v1/admin/audit-logs',
    {
      schema: apiSchema('Admin', 'Administrative audit history', pageOf(Audit), {
        querystring: PageQuery,
      }),
      preHandler: guard,
    },
    c.audit,
  );
}
