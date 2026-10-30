import { desc, eq } from 'drizzle-orm';
import { devices } from '../../database/schema/index.js';
export const devicesService = (app) => ({
  list: (userId) =>
    app.database.db
      .select()
      .from(devices)
      .where(eq(devices.userId, userId))
      .orderBy(desc(devices.lastSeenAt)),
});
