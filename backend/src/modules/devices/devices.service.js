import { desc, eq } from 'drizzle-orm';
import { devices } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';

export const devicesService = (app) => ({
  list: (userId) =>
    app.database.db
      .select({
        id: devices.id,
        deviceName: devices.deviceName,
        platform: devices.platform,
        lastSeenAt: devices.lastSeenAt,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(desc(devices.lastSeenAt)),
  async registerPushToken(userId, session, token) {
    if (!session?.deviceId) throw new AppError('Device not found', 404, 'NOT_FOUND');
    return app.push.register(userId, session.deviceId, token);
  },
});
