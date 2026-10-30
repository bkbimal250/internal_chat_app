import websocket from '@fastify/websocket';
import { gateway } from '../websocket/gateway.js';
export default async function registerWebsocket(app, config) {
  await app.register(websocket);
  app.get('/api/v1/ws', { websocket: true }, (connection, request) =>
    gateway(app, connection, request, config),
  );
}
