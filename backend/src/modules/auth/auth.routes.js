import { authController } from './auth.controller.js';
import {
  apiSchema,
  LoginBody,
  RefreshBody,
  ChangePasswordBody,
  Tokens,
  User,
  Ok,
} from './auth.schema.js';
export default async function authRoutes(app, config) {
  const controller = authController(app, config);
  const rate = { rateLimit: { max: config.authRateLimit, timeWindow: '1 minute' } };
  app.post(
    '/api/v1/auth/login',
    {
      schema: apiSchema(
        'Auth',
        'Login with employee credentials',
        Tokens,
        { body: LoginBody },
        false,
      ),
      config: rate,
    },
    controller.login,
  );
  app.post(
    '/api/v1/auth/refresh',
    {
      schema: apiSchema('Auth', 'Rotate a refresh token', Tokens, { body: RefreshBody }, false),
      config: rate,
    },
    controller.refresh,
  );
  app.get(
    '/api/v1/auth/me',
    {
      schema: apiSchema('Auth', 'Current authenticated account', User),
      preHandler: app.authenticateRestricted,
    },
    controller.me,
  );
  app.post(
    '/api/v1/auth/logout',
    {
      schema: apiSchema('Auth', 'Revoke current session', Ok),
      preHandler: app.authenticateRestricted,
    },
    controller.logout,
  );
  app.post(
    '/api/v1/auth/logout-all',
    {
      schema: apiSchema('Auth', 'Revoke all own sessions', Ok),
      preHandler: app.authenticateRestricted,
    },
    controller.logoutAll,
  );
  app.post(
    '/api/v1/auth/change-password',
    {
      schema: apiSchema('Auth', 'Change password and revoke all sessions', Ok, {
        body: ChangePasswordBody,
      }),
      preHandler: app.authenticateRestricted,
      config: rate,
    },
    controller.changePassword,
  );
}
