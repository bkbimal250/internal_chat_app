import { authService } from './auth.service.js';
import { publicUser, invalidSession } from './auth.repository.js';
import { accessToken, csrfToken } from '../../services/token.service.js';
import {
  checkTransport,
  checkCsrf,
  cookieOptions,
  REFRESH_COOKIE,
  CSRF_COOKIE,
} from '../../plugins/authentication.js';
import { AppError } from '../../utils/app-error.js';

export function authController(app, config) {
  const service = authService(app, config);
  const clear = (reply) => {
    reply.clearCookie(REFRESH_COOKIE, cookieOptions(config));
    reply.clearCookie(CSRF_COOKIE, { ...cookieOptions(config), path: '/', httpOnly: false });
  };
  const response = (reply, result) => {
    const { user, session, token } = result;
    const data = {
      accessToken: accessToken(app, user, session),
      tokenType: 'Bearer',
      expiresIn: 900,
      sessionId: session.id,
      deviceId: session.deviceId,
      refreshExpiresAt: session.expiresAt,
      user: publicUser(user),
    };
    if (session.transport === 'web') {
      const csrf = csrfToken(token, config.jwtSecret);
      reply.setCookie(REFRESH_COOKIE, token, {
        ...cookieOptions(config),
        expires: session.expiresAt,
      });
      reply.setCookie(CSRF_COOKIE, csrf, {
        ...cookieOptions(config),
        path: '/',
        httpOnly: false,
        expires: session.expiresAt,
      });
      data.csrfToken = csrf;
    } else data.refreshToken = token;
    return data;
  };
  return {
    login: async (request, reply) => {
      checkTransport(request, config);
      return response(reply, await service.login(request.body, { ip: request.ip }));
    },
    refresh: async (request, reply) => {
      const transport = checkTransport(request, config);
      if (transport === 'web' && request.body.refreshToken)
        throw new AppError('Use the refresh cookie', 400, 'INVALID_TRANSPORT');
      if (transport === 'web') checkCsrf(request, config);
      const token =
        transport === 'web' ? request.cookies[REFRESH_COOKIE] : request.body.refreshToken;
      if (!token || !/^[A-Za-z0-9_-]{64}$/.test(token)) throw invalidSession();
      try {
        return response(reply, await service.refresh(token, transport, { ip: request.ip }));
      } catch (error) {
        if (transport === 'web') clear(reply);
        throw error;
      }
    },
    me: async (request) => publicUser(request.auth.user),
    logout: async (request, reply) => {
      await service.logout(request.auth);
      clear(reply);
      return { success: true };
    },
    logoutAll: async (request, reply) => {
      await service.logout(request.auth, true);
      clear(reply);
      return { success: true };
    },
    changePassword: async (request, reply) => {
      await service.changePassword(request.auth, request.body);
      clear(reply);
      return { success: true };
    },
  };
}
