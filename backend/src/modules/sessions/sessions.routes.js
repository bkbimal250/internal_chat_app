import { Type as T } from '@sinclair/typebox';
import { sessionsController } from './sessions.controller.js';
import { apiSchema, IdParams, Session } from './sessions.schema.js';
import { object } from '../auth/auth.schema.js';
export default async function sessionRoutes(app) {
  const c = sessionsController(app);
  app.get(
    '/api/v1/sessions',
    {
      schema: apiSchema('Sessions', 'List active sessions', T.Array(Session)),
      preHandler: app.authenticate,
    },
    c.list,
  );
  app.delete(
    '/api/v1/sessions/:id',
    {
      schema: apiSchema('Sessions', 'Revoke one session', object({ success: T.Literal(true) }), {
        params: IdParams,
      }),
      preHandler: app.authenticate,
    },
    c.revoke,
  );
}
