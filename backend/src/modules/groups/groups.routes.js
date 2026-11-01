import { groupsController } from './groups.controller.js';
const id = { type: 'string', format: 'uuid' },
  o = (p) => ({ type: 'object', additionalProperties: false, properties: p });
export default async function groupRoutes(app, config) {
  const c = groupsController(app, config),
    g = app.authenticate;
  app.post(
    '/api/v1/groups',
    {
      preHandler: g,
      schema: {
        body: o({
          title: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', maxLength: 2000 },
        }),
      },
    },
    c.create,
  );
  app.get('/api/v1/groups', { preHandler: g }, c.list);
  app.get('/api/v1/groups/:id', { preHandler: g, schema: { params: o({ id }) } }, c.details);
  app.get('/api/v1/groups/:id/members', { preHandler: g, schema: { params: o({ id }) } }, c.members);
  app.patch(
    '/api/v1/groups/:id',
    {
      preHandler: g,
      schema: {
        params: o({ id }),
        body: o({
          title: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', maxLength: 2000 },
        }),
      },
    },
    c.update,
  );
  app.patch(
    '/api/v1/groups/:id/settings',
    {
      preHandler: g,
      schema: {
        params: o({ id }),
        body: o({
          editInfo: { type: 'string', enum: ['all', 'admins'] },
          sendMessages: { type: 'string', enum: ['all', 'admins'] },
          addMembers: { type: 'string', enum: ['all', 'admins'] },
        }),
      },
    },
    c.updateSettings,
  );
  app.post(
    '/api/v1/groups/:id/photo',
    {
      preHandler: g,
      schema: { params: o({ id }), body: o({ mimeType: { type: 'string', minLength: 1, maxLength: 80 } }) },
    },
    c.initPhoto,
  );
  app.post(
    '/api/v1/groups/:id/photo/complete',
    {
      preHandler: g,
      schema: {
        params: o({ id }),
        body: o({
          key: { type: 'string', minLength: 8, maxLength: 256 },
          mimeType: { type: 'string', minLength: 1, maxLength: 80 },
        }),
      },
    },
    c.completePhoto,
  );
  app.delete('/api/v1/groups/:id/photo', { preHandler: g, schema: { params: o({ id }) } }, c.removePhoto);
  app.get('/api/v1/groups/:id/photo-url', { preHandler: g, schema: { params: o({ id }) } }, c.photoUrl);
  app.post(
    '/api/v1/groups/:id/members',
    { preHandler: g, schema: { params: o({ id }), body: o({ userId: id }) } },
    c.add,
  );
  app.patch(
    '/api/v1/groups/:id/members/:userId/role',
    {
      preHandler: g,
      schema: {
        params: o({ id, userId: id }),
        body: o({ role: { type: 'string', enum: ['admin', 'member'] } }),
      },
    },
    c.role,
  );
  app.delete(
    '/api/v1/groups/:id/members/:userId',
    { preHandler: g, schema: { params: o({ id, userId: id }) } },
    c.remove,
  );
  app.post(
    '/api/v1/groups/:id/transfer-owner',
    { preHandler: g, schema: { params: o({ id }), body: o({ userId: id }) } },
    c.transfer,
  );
  app.post('/api/v1/groups/:id/leave', { preHandler: g, schema: { params: o({ id }) } }, c.leave);
}
