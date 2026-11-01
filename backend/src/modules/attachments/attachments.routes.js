import { TWO_GIB } from '../../services/upload-plan.js';
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
            sizeBytes: { type: 'integer', minimum: 1, maximum: TWO_GIB },
            strategy: { type: 'string', enum: ['single', 'multipart'] },
          },
          ['fileName', 'mimeType', 'sizeBytes'],
        ),
      },
    },
    controller.init,
  );
  app.post(
    '/api/v1/attachments/:id/parts',
    {
      preHandler: auth,
      config: rate,
      schema: {
        params: obj({ id }),
        body: obj(
          {
            partNumbers: {
              type: 'array',
              minItems: 1,
              maxItems: 40,
              items: { type: 'integer', minimum: 1, maximum: 10000 },
            },
          },
          ['partNumbers'],
        ),
      },
    },
    controller.signParts,
  );
  app.get(
    '/api/v1/attachments/:id/parts',
    {
      preHandler: auth,
      config: rate,
      schema: { params: obj({ id }) },
    },
    controller.listParts,
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
            parts: {
              type: 'array',
              minItems: 1,
              maxItems: 10000,
              items: obj(
                {
                  partNumber: { type: 'integer', minimum: 1, maximum: 10000 },
                  etag: { type: 'string', minLength: 1, maxLength: 200 },
                },
                ['partNumber', 'etag'],
              ),
            },
          },
          ['clientMessageId'],
        ),
      },
    },
    controller.finalize,
  );
  app.get(
    '/api/v1/attachments/:id/url',
    {
      preHandler: auth,
      config: rate,
      schema: {
        params: obj({ id }),
        querystring: obj({ download: { type: 'boolean' } }),
      },
    },
    controller.download,
  );
  app.delete(
    '/api/v1/attachments/:id',
    { preHandler: auth, schema: { params: obj({ id }) } },
    controller.destroy,
  );
}
