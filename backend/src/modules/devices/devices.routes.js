import { Type as T } from '@sinclair/typebox';
import { devicesController } from './devices.controller.js';
import { apiSchema, Device } from './devices.schema.js';

export default async function deviceRoutes(app) {
  const controller = devicesController(app);
  app.get(
    '/api/v1/devices',
    {
      schema: apiSchema('Devices', 'List known devices', T.Array(Device)),
      preHandler: app.authenticate,
    },
    controller.list,
  );
  app.put(
    '/api/v1/devices/push-token',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 20, maxLength: 4096 },
          },
        },
      },
    },
    controller.registerPush,
  );
}
