import { notifyService } from './notify.service.js';

const id = { type: 'string', format: 'uuid' };
const obj = (properties, required) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required ? { required } : {}),
});

export default async function notifyRoutes(app) {
  const service = notifyService(app);
  const auth = app.authenticate;

  app.get('/api/v1/notification-preferences', { preHandler: auth }, (request) =>
    service.getPreferences(request.auth.userId),
  );

  app.patch(
    '/api/v1/notification-preferences',
    {
      preHandler: auth,
      schema: {
        body: obj({
          messagesEnabled: { type: 'boolean' },
          sound: { type: 'boolean' },
          vibration: { type: 'boolean' },
          showPreview: { type: 'boolean' },
          showSenderOnLockScreen: { type: 'boolean' },
          groupNotifications: { type: 'boolean' },
          retentionReminders: { type: 'boolean' },
        }),
      },
    },
    (request) => service.updatePreferences(request.auth.userId, request.body),
  );

  app.post(
    '/api/v1/conversations/mute',
    {
      preHandler: auth,
      schema: {
        body: obj(
          {
            conversationIds: { type: 'array', minItems: 1, maxItems: 50, items: id },
            muted: { type: 'boolean' },
            until: { type: 'string', format: 'date-time' },
          },
          ['conversationIds', 'muted'],
        ),
      },
    },
    async (request, reply) => {
      const body = await service.muteMany(request.auth.userId, request.body.conversationIds, request.body);
      if (body.failed.length && !body.muted.length) reply.code(400);
      return body;
    },
  );

  app.post(
    '/api/v1/conversations/:id/mute',
    {
      preHandler: auth,
      schema: {
        params: obj({ id }),
        body: obj(
          {
            muted: { type: 'boolean' },
            until: { type: 'string', format: 'date-time' },
          },
          ['muted'],
        ),
      },
    },
    (request) => service.mute(request.params.id, request.auth.userId, request.body),
  );
}
