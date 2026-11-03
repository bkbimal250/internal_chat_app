import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { devices } from '../database/schema/index.js';

const fallbackPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../secrets/firebase-service-account.json');

function loadMessaging(config, logger) {
  const path = config.firebaseServiceAccountPath || fallbackPath;
  if (!existsSync(path)) {
    logger?.info({ code: 'PUSH_UNCONFIGURED' }, 'Firebase service account not found; push disabled');
    return null;
  }
  try {
    const credentials = JSON.parse(readFileSync(path, 'utf8'));
    if (!credentials.private_key || !credentials.client_email) {
      logger?.info({ code: 'PUSH_UNCONFIGURED' }, 'Firebase service account not configured; push disabled');
      return null;
    }
    if (!getApps().length) initializeApp({ credential: cert(credentials) });
    return getMessaging();
  } catch (error) {
    logger?.warn({ err: error, code: 'PUSH_INIT_FAILED' }, 'Unable to initialize Firebase messaging');
    return null;
  }
}

function stringifyData(data) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
}

export function pushService(app, config) {
  const db = app.database.db;
  const messaging = loadMessaging(config, app.log);

  async function clearToken(token) {
    await db.update(devices).set({ pushToken: null, pushTokenUpdatedAt: new Date() }).where(eq(devices.pushToken, token));
  }

  return {
    enabled: Boolean(messaging),
    async register(userId, deviceId, token) {
      const value = String(token || '').trim();
      if (value.length < 20 || value.length > 4096) {
        return { registered: false };
      }
      await db
        .update(devices)
        .set({ pushToken: null, pushTokenUpdatedAt: new Date() })
        .where(and(eq(devices.pushToken, value), ne(devices.id, deviceId)));
      await db
        .update(devices)
        .set({ pushToken: value, pushTokenUpdatedAt: new Date(), lastSeenAt: new Date() })
        .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)));
      return { registered: true };
    },
    async sendToUser(
      userId,
      { title, body, data = {}, android = {}, apns = {}, collapseKey, includeNotification = true } = {},
    ) {
      if (!messaging || !userId || !title) return { sent: 0 };
      const rows = await db
        .select({ id: devices.id, token: devices.pushToken })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNotNull(devices.pushToken)));
      const channelId = android.channelId || 'company_chat_messages';
      const tag = android.tag || data.conversationId || undefined;
      const safeData = stringifyData({
        ...data,
        title,
        body,
        channelId,
      });
      let sent = 0;
      for (const row of rows) {
        if (!row.token) continue;
        try {
          const payload = {
            token: row.token,
            data: safeData,
            android: {
              priority: 'high',
              collapseKey: collapseKey || (android.tag && android.tag.length <= 64 ? android.tag : undefined),
            },
            apns: {
              headers: {
                ...(tag ? { 'apns-collapse-id': String(tag).slice(0, 64) } : {}),
                'apns-priority': '10',
              },
              payload: {
                aps: {
                  ...(includeNotification ? { alert: { title: String(title).slice(0, 160), body: String(body || '').slice(0, 500) } } : {}),
                  ...(apns.sound === false || android.sound === false ? {} : { sound: 'default' }),
                  badge: 1,
                  ...(apns.threadId ? { threadId: String(apns.threadId) } : {}),
                  category: apns.category || 'MESSAGE',
                },
              },
            },
          };
          if (includeNotification && android.dataOnly !== true) {
            payload.notification = {
              title: String(title).slice(0, 160),
              body: String(body || '').slice(0, 500),
            };
            payload.android.notification = {
              channelId,
              ...(tag ? { tag: String(tag) } : {}),
              ...(android.sound === false ? {} : { sound: 'default' }),
              defaultVibrateTimings: android.vibrate !== false,
              visibility: android.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
            };
          }
          await messaging.send(payload);
          sent += 1;
        } catch (error) {
          const code = error?.errorInfo?.code || error?.code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            await clearToken(row.token);
          } else {
            app.log?.warn({ err: error, code: 'PUSH_SEND_FAILED' }, 'Unable to send push notification');
          }
        }
      }
      return { sent };
    },
  };
}
