import { createHmac } from 'node:crypto';

const DEFAULT_STUN = Object.freeze(['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']);
const USERNAME_TTL_SECONDS = 12 * 60 * 60;

function parseIceUrls(raw, fallback) {
  const list = String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

export function iceUrlsFromEnv(config) {
  return {
    stunUrls: parseIceUrls(config.stunUrls, DEFAULT_STUN),
    turnUrls: parseIceUrls(config.turnUrls, []),
  };
}

export function turnCredentials(secret, userId, now = Date.now(), ttlSeconds = USERNAME_TTL_SECONDS) {
  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiry}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiresAt: new Date(expiry * 1000).toISOString() };
}

export function buildIceConfig(config, userId, now = Date.now()) {
  const { stunUrls, turnUrls } = iceUrlsFromEnv(config);
  const iceServers = [];
  if (stunUrls.length) iceServers.push({ urls: stunUrls });
  let turnConfigured = false;
  if (turnUrls.length && config.turnSecret) {
    const creds = turnCredentials(config.turnSecret, userId, now);
    iceServers.push({
      urls: turnUrls,
      username: creds.username,
      credential: creds.credential,
    });
    turnConfigured = true;
    return {
      iceServers,
      turnConfigured,
      ttlSeconds: USERNAME_TTL_SECONDS,
      expiresAt: creds.expiresAt,
    };
  }
  return {
    iceServers,
    turnConfigured,
    ttlSeconds: USERNAME_TTL_SECONDS,
    expiresAt: new Date(now + USERNAME_TTL_SECONDS * 1000).toISOString(),
  };
}
