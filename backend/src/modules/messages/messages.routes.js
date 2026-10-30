import { messagesController } from './messages.controller.js';
const id = { type: 'string', format: 'uuid' },
  obj = (p, required) => ({
    type: 'object',
    additionalProperties: false,
    properties: p,
    ...(required ? { required } : {}),
  });
export default async function messageRoutes(app) {
  const c = messagesController(app),
    g = app.authenticate;
  app.get(
    '/api/v1/conversations/:id/messages',
    {
      preHandler: g,
      schema: {
        params: obj({ id }),
        querystring: obj({
          afterSeq: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        }),
      },
    },
    c.list,
  );
  app.get(
    '/api/v1/conversations/:id/sync',
    {
      preHandler: g,
      schema: {
        params: obj({ id }),
        querystring: obj({
          afterChangeSeq: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        }),
      },
    },
    c.sync,
  );
  app.post(
    '/api/v1/conversations/:id/messages',
    {
      preHandler: g,
      schema: {
        params: obj({ id }),
        body: obj(
          {
            clientMessageId: id,
            content: { type: 'string', minLength: 1, maxLength: 4000 },
            replyToMessageId: id,
            forwardedFromMessageId: id,
          },
          ['clientMessageId', 'content'],
        ),
      },
    },
    c.create,
  );
  app.get('/api/v1/messages/:id', { preHandler: g, schema: { params: obj({ id }) } }, c.get);
  app.patch(
    '/api/v1/messages/:id',
    {
      preHandler: g,
      schema: {
        params: obj({ id }),
        body: obj({ content: { type: 'string', minLength: 1, maxLength: 4000 } }, ['content']),
      },
    },
    c.edit,
  );
  app.delete('/api/v1/messages/:id', { preHandler: g, schema: { params: obj({ id }) } }, c.remove);
  app.post(
    '/api/v1/messages/:id/forward',
    {
      preHandler: g,
      schema: {
        params: obj({ id }),
        body: obj(
          {
            conversationId: id,
            clientMessageId: id,
            content: { type: 'string', minLength: 1, maxLength: 4000 },
          },
          ['conversationId', 'clientMessageId', 'content'],
        ),
      },
    },
    c.forward,
  );
}
