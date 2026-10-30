import { attachmentsController } from './attachments.controller.js';

const id = { type: 'string', format: 'uuid' };
const obj = (properties, required) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required ? { required } : {}),
});

export default async function attachmentRoutes(app, config) {
  const controller = attachmentsController(app, config);
  const auth = app.authenticate;
  const rate = { rateLimit: { max: config.attachmentRateLimit, timeWindow: '1 minute' } };
  app.post(
    '/api/v1/conversations/:id/attachments',
    {
      preHandler: auth,
      config: rate,
      schema: {
        params: obj({ id }),
        body: obj(
          {
            fileName: { type: 'string', minLength: 1, maxLength: 255 },
            mimeType: { type: 'string', minLength: 3, maxLength: 127 },
            sizeBytes: { type: 'integer', minimum: 1, maximum: 52_428_800 },
          },
          ['fileName', 'mimeType', 'sizeBytes'],
        ),
      },
    },
    controller.init,
  );
  app.post(
    '/api/v1/attachments/:id/finalize',
    {
      preHandler: auth,
      config: rate,
      schema: {
        params: obj({ id }),
        body: obj(
          {
            clientMessageId: id,
            caption: { type: 'string', maxLength: 4000 },
            replyToMessageId: id,
          },
          ['clientMessageId'],
        ),
      },
    },
    controller.finalize,
  );
  app.get(
    '/api/v1/attachments/:id/url',
    { preHandler: auth, config: rate, schema: { params: obj({ id }) } },
    controller.download,
  );
  app.delete(
    '/api/v1/attachments/:id',
    { preHandler: auth, schema: { params: obj({ id }) } },
    controller.destroy,
  );
}
