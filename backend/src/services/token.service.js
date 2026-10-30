import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const newRefreshToken = () => randomBytes(48).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const csrfToken = (token, secret) =>
  createHmac('sha256', secret).update(`csrf:${token}`).digest('base64url');
export function equalToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function accessToken(app, user, session) {
  return app.jwt.sign({ sub: user.id, sid: session.id }, { expiresIn: '15m' });
}
