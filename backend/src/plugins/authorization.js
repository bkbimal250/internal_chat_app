import { requireAuth } from '../middleware/require-auth.js';
import { adminOnly } from '../middleware/admin-only.js';
export default function registerAuthorization(app) {
  app.decorateRequest('auth', null);
  app.decorate('authenticate', requireAuth(app));
  app.decorate('authenticateRestricted', requireAuth(app, { allowPasswordChange: true }));
  app.decorate('adminOnly', adminOnly);
}
