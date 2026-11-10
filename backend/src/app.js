import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import { loadEnv } from './config/env.js';
import { BODY_LIMIT_BYTES, SERVICE_NAME } from './config/constants.js';
import { createDatabase } from './database/index.js';
import { loggerOptions } from './utils/logger.js';
import { installErrorHandler } from './middleware/error-handler.js';
import registerHelmet from './plugins/helmet.js';
import registerCors from './plugins/cors.js';
import registerAuthentication from './plugins/authentication.js';
import registerAuthorization from './plugins/authorization.js';
import registerRateLimit from './plugins/rate-limit.js';
import registerSwagger from './plugins/swagger.js';
import authRoutes from './modules/auth/auth.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import userRoutes from './modules/users/users.routes.js';
import deviceRoutes from './modules/devices/devices.routes.js';
import sessionRoutes from './modules/sessions/sessions.routes.js';
import conversationRoutes from './modules/conversations/conversations.routes.js';
import messageRoutes from './modules/messages/messages.routes.js';
import groupRoutes from './modules/groups/groups.routes.js';
import receiptRoutes from './modules/receipts/receipts.routes.js';
import registerWebsocket from './plugins/websocket.js';
import { ConnectionManager } from './websocket/connection-manager.js';
import { broadcaster } from './websocket/broadcaster.js';
import { cleanupSessions } from './jobs/session-cleanup.job.js';
import { cleanupAttachments } from './jobs/attachment-cleanup.job.js';
import { objectStorage } from './services/object-storage.service.js';
import { pushService } from './services/push.service.js';
import attachmentRoutes from './modules/attachments/attachments.routes.js';
import retentionRoutes from './modules/retention/retention.routes.js';
import notifyRoutes from './modules/notify/notify.routes.js';
import callRoutes from './modules/calls/calls.routes.js';
import { callsService } from './modules/calls/calls.service.js';
import { expireStaleCalls } from './jobs/call-timeout.job.js';

export async function buildApp({ config = loadEnv() } = {}) {
  const app = Fastify({
    logger: loggerOptions(config),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: BODY_LIMIT_BYTES,
    requestTimeout: 30000,
    return503OnClosing: true,
    trustProxy: config.trustProxy,
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  });
  const database = createDatabase(config, app.log);
  app.decorate('database', database);
  // Phase 3 WebSocket gateway subscribes here to disconnect revoked sessions.
  app.decorate('sessionEvents', new EventEmitter());
  app.decorate('connections', new ConnectionManager());
  app.decorate('broadcaster', broadcaster(app));
  app.decorate('storage', objectStorage(config, app.log));
  app.decorate('push', pushService(app, config));
  app.decorate('calls', callsService(app, config));
  if (config.nodeEnv === 'test') app.decorate('otpInbox', new Map());
  app.sessionEvents.on('revoked', ({ sessionIds }) => {
    for (const sessionId of sessionIds) {
      for (const userId of app.connections.closeSession(sessionId)) {
        app.broadcaster.presence(userId, false).catch(() =>
          app.log.warn({ userId }, 'Unable to broadcast offline presence'),
        );
      }
    }
    app.calls.endOwnedBySessions(sessionIds).catch(() =>
      app.log.warn({ code: 'CALL_SESSION_END_FAILED' }, 'Unable to end calls for revoked sessions'),
    );
  });
  app.addHook('onClose', async () => database.close());
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });
  installErrorHandler(app, config);
  try {
    await registerHelmet(app);
    await registerCors(app, config);
    await registerAuthentication(app, config);
    registerAuthorization(app);
    await registerRateLimit(app);
    app.get('/health/live', async () => {
      const payload = { status: 'ok', service: SERVICE_NAME };
      if (process.env.GIT_SHA) payload.version = process.env.GIT_SHA;
      return payload;
    });
    app.get('/health/ready', async (request, reply) => {
      try {
        await database.check();
        const storage = await app.storage.ready();
        const payload = {
          status: 'ready',
          database: 'connected',
          storage,
          attachmentsEnabled: Boolean(config.chatAttachmentsEnabled),
          callsEnabled: Boolean(config.callsEnabled),
        };
        if (process.env.GIT_SHA) payload.version = process.env.GIT_SHA;
        return payload;
      } catch {
        request.log.warn({ code: 'DATABASE_UNAVAILABLE' }, 'Readiness check failed');
        return reply.code(503).send({
          status: 'not_ready',
          database: 'disconnected',
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database unavailable',
            requestId: request.id,
          },
        });
      }
    });
    await authRoutes(app, config);
    await adminRoutes(app, config);
    await userRoutes(app, config);
    await deviceRoutes(app, config);
    await sessionRoutes(app, config);
    await conversationRoutes(app, config);
    await messageRoutes(app, config);
    await groupRoutes(app, config);
    await receiptRoutes(app, config);
    await attachmentRoutes(app, config);
    await retentionRoutes(app, config);
    await notifyRoutes(app);
    await callRoutes(app, config);
    await registerWebsocket(app, config);
    if (config.nodeEnv !== 'test') {
      const listener = await database.pool.connect();
      await listener.query('LISTEN retention');
      listener.on('notification', (message) => {
        try {
          const payload = JSON.parse(message.payload);
          if (payload.userId) app.broadcaster.user(payload.userId, payload.event, payload.data);
          else if (payload.conversationId) {
            app.broadcaster.conversation(payload.conversationId, payload.event, payload.data).catch(() => {});
          }
        } catch {
          app.log.warn({ code: 'RETENTION_NOTIFY_FAILED' }, 'Unable to fan out retention event');
        }
      });
      app.addHook('onClose', async () => {
        try {
          await listener.query('UNLISTEN retention');
        } catch {
          /* ignore */
        }
        listener.release();
      });
    }
    await app.storage.ensureBucket().catch((error) => {
      app.log.warn({ err: error, code: 'STORAGE_INIT_FAILED' }, 'Object storage bucket setup failed');
    });
    await registerSwagger(app);
    const cleanupTimer = setInterval(() => {
      cleanupSessions(database).catch(() =>
        app.log.warn({ code: 'SESSION_CLEANUP_FAILED' }, 'Session cleanup failed'),
      );
      cleanupAttachments(app).catch(() =>
        app.log.warn({ code: 'ATTACHMENT_CLEANUP_FAILED' }, 'Attachment cleanup failed'),
      );
    }, config.cleanupIntervalMs);
    cleanupTimer.unref();
    const callTimer = setInterval(() => {
      expireStaleCalls(app).catch(() =>
        app.log.warn({ code: 'CALL_TIMEOUT_FAILED' }, 'Call timeout sweep failed'),
      );
    }, config.callSweepIntervalMs);
    callTimer.unref();
    app.addHook('onClose', async () => {
      clearInterval(cleanupTimer);
      clearInterval(callTimer);
    });
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
