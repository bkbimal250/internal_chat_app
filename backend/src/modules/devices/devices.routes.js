import { Type as T } from '@sinclair/typebox';
import { devicesController } from './devices.controller.js';
import { apiSchema, Device } from './devices.schema.js';
export default async function deviceRoutes(app) {
  app.get(
    '/api/v1/devices',
    {
      schema: apiSchema('Devices', 'List known devices', T.Array(Device)),
      preHandler: app.authenticate,
    },
    devicesController(app).list,
  );
}
