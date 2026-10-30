import { randomUUID } from 'node:crypto';
import { websocketAuth } from './websocket-auth.js';
import { envelope } from './connection-manager.js';
import { events } from './event-handler.js';
export async function gateway(app, connection, request, config) {
  const auth = await websocketAuth(app, request);
  const socket = connection.socket ?? connection;
  if (!auth) return socket.close(4001, 'unauthorized');
  const c = {
    id: randomUUID(),
    socket,
    userId: auth.user.id,
    sessionId: auth.session.id,
  };
  const becameOnline = app.connections.add(c);
  socket.send(
    JSON.stringify(envelope('connection.ready', { userId: c.userId, sessionId: c.sessionId })),
  );
  socket.on('message', events(app, c));
  c.alive = true;
  const heartbeat = setInterval(() => {
    if (!c.alive) return socket.terminate();
    c.alive = false;
    socket.ping();
  }, config.wsHeartbeatIntervalMs);
  heartbeat.unref();
  socket.on('pong', () => {
    c.alive = true;
  });
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    clearInterval(heartbeat);
    if (app.connections.remove(c)) {
      app.broadcaster.presence(c.userId, false).catch(() =>
        app.log.warn({ userId: c.userId }, 'Unable to broadcast offline presence'),
      );
    }
  };
  socket.on('close', remove);
  socket.on('error', remove);
  if (becameOnline) {
    app.broadcaster.presence(c.userId, true).catch(() =>
      app.log.warn({ userId: c.userId }, 'Unable to broadcast online presence'),
    );
  }
  app.broadcaster.presenceSnapshot(c).catch(() =>
    app.log.warn({ userId: c.userId }, 'Unable to send presence snapshot'),
  );
}
