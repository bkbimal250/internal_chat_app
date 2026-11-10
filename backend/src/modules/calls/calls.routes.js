import { callsController } from './calls.controller.js';

const id = { type: 'string', format: 'uuid' };
const obj = (properties, required) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required ? { required } : {}),
});

export default async function callRoutes(app, config) {
  const controller = callsController(app);
  const auth = app.authenticate;
  const callRate = { rateLimit: { max: config.callRateLimit, timeWindow: '1 minute' } };
  const iceRate = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  app.get('/api/v1/calls/capabilities', { preHandler: auth }, controller.capabilities);
  app.get('/api/v1/calls/ice-config', { preHandler: auth, config: iceRate }, controller.iceConfig);
  app.post(
    '/api/v1/calls',
    {
      preHandler: auth,
      config: callRate,
      schema: { body: obj({ calleeId: id }, ['calleeId']) },
    },
    controller.create,
  );
  app.get('/api/v1/calls/:id', { preHandler: auth, schema: { params: obj({ id }) } }, controller.get);
  app.post('/api/v1/calls/:id/accept', { preHandler: auth, schema: { params: obj({ id }) } }, controller.accept);
  app.post('/api/v1/calls/:id/reject', { preHandler: auth, schema: { params: obj({ id }) } }, controller.reject);
  app.post('/api/v1/calls/:id/cancel', { preHandler: auth, schema: { params: obj({ id }) } }, controller.cancel);
  app.post('/api/v1/calls/:id/busy', { preHandler: auth, schema: { params: obj({ id }) } }, controller.busy);
  app.post('/api/v1/calls/:id/connected', { preHandler: auth, schema: { params: obj({ id }) } }, controller.connected);
  app.post('/api/v1/calls/:id/end', { preHandler: auth, schema: { params: obj({ id }) } }, controller.end);
}
