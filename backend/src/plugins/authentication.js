import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { csrfToken, equalToken } from '../services/token.service.js';
import { AppError } from '../utils/app-error.js';

export const REFRESH_COOKIE = 'chat_refresh';
export const CSRF_COOKIE = 'chat_csrf';
export const cookieOptions = (config) => ({
  path: '/api/v1/auth',
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'strict',
});

function cookieExpiry(config, expiresAt) {
  const parsed = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return new Date(Date.now() + config.refreshTokenDays * 86400000);
}

export function persistentCookieOptions(config, expiresAt) {
  const expires = cookieExpiry(config, expiresAt);
  const maxAge = Math.max(1, Math.floor((expires.getTime() - Date.now()) / 1000));
  return {
    ...cookieOptions(config),
    expires,
    maxAge,
  };
}
export function checkOrigin(request, config) {
  if (!request.headers.origin || !config.corsOrigins.includes(request.headers.origin)) {
    throw new AppError('Origin not allowed', 403, 'ORIGIN_FORBIDDEN');
  }
}
export function checkCsrf(request, config) {
  checkOrigin(request, config);
  const token = request.cookies[REFRESH_COOKIE];
  if (!token || !equalToken(request.headers['x-csrf-token'], csrfToken(token, config.jwtSecret))) {
    throw new AppError('CSRF validation failed', 403, 'CSRF_FAILED');
  }
}
export function checkTransport(request, config) {
  const transport = request.body.clientType;
  if (transport === 'web') {
    checkOrigin(request, config);
    if (request.headers['x-requested-with'] !== 'company-chat') {
      throw new AppError('Browser request header required', 403, 'CSRF_FAILED');
    }
    if (request.body.platform && request.body.platform !== 'web') {
      throw new AppError('Invalid client platform', 400, 'INVALID_PLATFORM');
    }
  } else {
    if (
      request.headers.origin ||
      request.headers['sec-fetch-site'] ||
      request.cookies[REFRESH_COOKIE]
    ) {
      throw new AppError(
        'Native token transport is not available to browsers',
        403,
        'TRANSPORT_FORBIDDEN',
      );
    }
    if (request.body.platform === 'web')
      throw new AppError('Invalid client platform', 400, 'INVALID_PLATFORM');
  }
  return transport;
}
export default async function registerAuthentication(app, config) {
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    sign: { algorithm: 'HS256', iss: config.jwtIssuer, aud: config.jwtAudience },
    verify: { algorithms: ['HS256'], allowedIss: config.jwtIssuer, allowedAud: config.jwtAudience },
  });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/v1')) return;
    reply.header('cache-control', 'no-store');
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) {
      if (request.headers.origin) checkOrigin(request, config);
      const path = request.url.split('?')[0];
      const publicAuth =
        path.endsWith('/auth/login') ||
        path.endsWith('/auth/otp/request') ||
        path.endsWith('/auth/otp/verify');
      if (request.cookies[REFRESH_COOKIE] && !publicAuth) checkCsrf(request, config);
    }
  });
}
