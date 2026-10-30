import { receiptsController } from './receipts.controller.js';
const id = { type: 'string', format: 'uuid' };
export default async function receiptRoutes(app) {
  app.get(
    '/api/v1/conversations/:id/receipts',
    {
      preHandler: app.authenticate,
      schema: { params: { type: 'object', additionalProperties: false, properties: { id } } },
    },
    receiptsController(app).listConversation,
  );
  app.get(
    '/api/v1/messages/:id/receipts',
    {
      preHandler: app.authenticate,
      schema: { params: { type: 'object', additionalProperties: false, properties: { id } } },
    },
    receiptsController(app).list,
  );
  app.post(
    '/api/v1/messages/:id/delivered',
    {
      preHandler: app.authenticate,
      schema: { params: { type: 'object', additionalProperties: false, properties: { id } } },
    },
    receiptsController(app).delivered,
  );
}
