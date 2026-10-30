import { conversationsController } from './conversations.controller.js';
const id = { type: 'string', format: 'uuid' };
const obj = (p) => ({ type: 'object', additionalProperties: false, properties: p });
export default async function conversationRoutes(app) {
  const c = conversationsController(app);
  const guard = app.authenticate;
  app.post(
    '/api/v1/conversations/direct',
    { preHandler: guard, schema: { body: obj({ userId: id }) } },
    c.direct,
  );
  app.get(
    '/api/v1/conversations',
    {
      preHandler: guard,
      schema: {
        querystring: obj({
          cursor: { type: 'string', format: 'date-time' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        }),
      },
    },
    c.list,
  );
  app.get(
    '/api/v1/conversations/:id',
    { preHandler: guard, schema: { params: obj({ id }) } },
    c.details,
  );
  app.post(
    '/api/v1/conversations/:id/read',
    {
      preHandler: guard,
      schema: {
        params: obj({ id }),
        body: obj({ sequenceNumber: { type: 'integer', minimum: 0 } }),
      },
    },
    c.read,
  );
}
