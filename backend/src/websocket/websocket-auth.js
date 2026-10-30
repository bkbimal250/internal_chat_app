import { and, eq, gt, isNull } from 'drizzle-orm';
import { sessions, users } from '../database/schema/index.js';

function tokenFromRequest(request) {
  const header = request.headers.authorization;
  if (typeof header === 'string' && /^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '').trim();
  }
  const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (protocols[0] === 'company-chat' && protocols[1]) return protocols[1];
  return protocols.find((item) => item.split('.').length === 3) ?? null;
}

export async function websocketAuth(app, request) {
  try {
    const token = tokenFromRequest(request);
    if (!token) return null;
    request.user = await app.jwt.verify(token);
  } catch {
    return null;
  }
  const [x] = await app.database.db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, request.user.sid),
        eq(users.id, request.user.sub),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return x ?? null;
}
