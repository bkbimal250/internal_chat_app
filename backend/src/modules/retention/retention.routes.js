import { retentionController } from './retention.controller.js';

const id = { type: 'string', format: 'uuid' };
const obj = (properties, required) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required ? { required } : {}),
});

export default async function retentionRoutes(app, config) {
  const c = retentionController(app, config);
  const auth = app.authenticate;
  const admin = [app.authenticate, app.adminOnly];
  app.get('/api/v1/retention/policy', { preHandler: auth }, c.policy);
  app.get('/api/v1/conversations/:id/retention', { preHandler: auth, schema: { params: obj({ id }) } }, c.conversation);
  app.get('/api/v1/notifications', { preHandler: auth }, c.notifications);
  app.post(
    '/api/v1/notifications/:id/read',
    { preHandler: auth, schema: { params: obj({ id }) } },
    c.readNotification,
  );
  app.post(
    '/api/v1/conversations/:id/export',
    {
      preHandler: auth,
      config: { rateLimit: { max: 4, timeWindow: '1 hour' } },
      schema: { params: obj({ id }) },
    },
    c.exportChat,
  );
  app.get('/api/v1/exports/:id', { preHandler: auth, schema: { params: obj({ id }) } }, c.exportStatus);
  app.get('/api/v1/admin/retention', { preHandler: admin }, async () => {
    const [policy, preview, jobs] = await Promise.all([c.policy(), c.preview(), c.jobs()]);
    return { policy, preview, jobs };
  });
  app.patch(
    '/api/v1/admin/retention',
    {
      preHandler: admin,
      schema: {
        body: obj({
          retentionDays: { type: 'integer', enum: [30, 90, 180] },
          remindersEnabled: { type: 'boolean' },
          existingGraceDays: { type: 'integer', minimum: 1, maximum: 365 },
          legalHold: { type: 'boolean' },
        }),
      },
    },
    c.updatePolicy,
  );
  app.post('/api/v1/admin/retention/activate', { preHandler: admin }, c.activate);
  app.post('/api/v1/admin/retention/pause', { preHandler: admin }, c.pause);
  app.post(
    '/api/v1/admin/retention/holds',
    {
      preHandler: admin,
      schema: {
        body: obj(
          {
            conversationId: id,
            reason: { type: 'string', minLength: 3, maxLength: 255 },
          },
          ['conversationId', 'reason'],
        ),
      },
    },
    c.hold,
  );
  app.post(
    '/api/v1/admin/retention/holds/:id/release',
    { preHandler: admin, schema: { params: obj({ id }) } },
    c.releaseHold,
  );
}
