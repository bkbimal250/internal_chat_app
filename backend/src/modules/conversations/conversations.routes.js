import { conversationsController } from './conversations.controller.js';
const id = { type: 'string', format: 'uuid' };
const obj = (p, required) => ({
  type: 'object',
  additionalProperties: false,
  properties: p,
  ...(required ? { required } : {}),
});
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
          archived: { type: 'boolean' },
        }),
      },
    },
    c.list,
  );
  const idsBody = obj(
    {
      conversationIds: { type: 'array', minItems: 1, maxItems: 50, items: id },
    },
    ['conversationIds'],
  );
  app.post(
    '/api/v1/conversations/hide',
    {
      preHandler: guard,
      schema: { body: idsBody },
    },
    c.hideMany,
  );
  app.post(
    '/api/v1/conversations/pin',
    {
      preHandler: guard,
      schema: { body: obj({ conversationIds: idsBody.properties.conversationIds, pinned: { type: 'boolean' } }, ['conversationIds', 'pinned']) },
    },
    c.pinMany,
  );
  app.post(
    '/api/v1/conversations/archive',
    {
      preHandler: guard,
      schema: { body: obj({ conversationIds: idsBody.properties.conversationIds, archived: { type: 'boolean' } }, ['conversationIds', 'archived']) },
    },
    c.archiveMany,
  );
  app.post(
    '/api/v1/conversations/unread',
    { preHandler: guard, schema: { body: idsBody } },
    c.unreadMany,
  );
  app.post(
    '/api/v1/conversations/read',
    { preHandler: guard, schema: { body: idsBody } },
    c.readMany,
  );
  app.get(
    '/api/v1/conversations/:id',
    { preHandler: guard, schema: { params: obj({ id }) } },
    c.details,
  );
  app.post(
    '/api/v1/conversations/:id/hide',
    { preHandler: guard, schema: { params: obj({ id }) } },
    c.hide,
  );
  app.post(
    '/api/v1/conversations/:id/pin',
    {
      preHandler: guard,
      schema: { params: obj({ id }), body: obj({ pinned: { type: 'boolean' } }, ['pinned']) },
    },
    c.pin,
  );
  app.post(
    '/api/v1/conversations/:id/archive',
    {
      preHandler: guard,
      schema: { params: obj({ id }), body: obj({ archived: { type: 'boolean' } }, ['archived']) },
    },
    c.archive,
  );
  app.post(
    '/api/v1/conversations/:id/unread',
    { preHandler: guard, schema: { params: obj({ id }) } },
    c.unread,
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
