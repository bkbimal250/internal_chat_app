import { authService } from './auth.service.js';
import { publicUser, invalidSession } from './auth.repository.js';
import { otpService } from '../otp/otp.service.js';
import { profilePhotoService } from '../../services/profile-photo.service.js';
import { accessToken, csrfToken } from '../../services/token.service.js';
import {
  checkTransport,
  checkCsrf,
  cookieOptions,
  persistentCookieOptions,
  REFRESH_COOKIE,
  CSRF_COOKIE,
} from '../../plugins/authentication.js';
import { AppError } from '../../utils/app-error.js';

export function authController(app, config) {
  const service = authService(app, config);
  const otp = otpService(app, config);
  const photos = profilePhotoService(app, config);
  const present = async (user) =>
    publicUser({
      ...user,
      profilePhotoUrl: user.profilePhotoKey ? await photos.url(user).catch(() => null) : null,
    });
  const clear = (reply) => {
    reply.clearCookie(REFRESH_COOKIE, cookieOptions(config));
    reply.clearCookie(CSRF_COOKIE, { ...cookieOptions(config), path: '/', httpOnly: false });
  };
  const response = async (reply, result) => {
    const { user, session, token } = result;
    const data = {
      accessToken: accessToken(app, user, session),
      tokenType: 'Bearer',
      expiresIn: 900,
      sessionId: session.id,
      deviceId: session.deviceId,
      refreshExpiresAt: session.expiresAt,
      user: await present(user),
    };
    if (session.transport === 'web') {
      const csrf = csrfToken(token, config.jwtSecret);
      const persistent = persistentCookieOptions(config, session.expiresAt);
      reply.setCookie(REFRESH_COOKIE, token, persistent);
      reply.setCookie(CSRF_COOKIE, csrf, {
        ...persistent,
        path: '/',
        httpOnly: false,
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
    requestOtp: async (request) => otp.request(request.body, request.log),
    verifyOtp: async (request, reply) => {
      checkTransport(request, config);
      const user = await otp.verify(request.body);
      return response(reply, await service.loginWithOtp(user, request.body, { ip: request.ip }));
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
    me: async (request) => present(request.auth.user),
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
