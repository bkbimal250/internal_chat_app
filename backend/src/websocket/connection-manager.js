import { randomUUID } from 'node:crypto';
export class ConnectionManager {
  constructor() {
    this.byUser = new Map();
    this.bySession = new Map();
  }
  add(c) {
    const wasOffline = !this.byUser.has(c.userId);
    for (const [map, key] of [
      [this.byUser, c.userId],
      [this.bySession, c.sessionId],
    ]) {
      const set = map.get(key) ?? new Set();
      set.add(c);
      map.set(key, set);
    }
    return wasOffline;
  }
  remove(c) {
    const existed = this.byUser.get(c.userId)?.has(c) === true;
    for (const [map, key] of [
      [this.byUser, c.userId],
      [this.bySession, c.sessionId],
    ]) {
      const set = map.get(key);
      if (set) {
        set.delete(c);
        if (!set.size) map.delete(key);
      }
    }
    return existed && !this.byUser.has(c.userId);
  }
  user(id) {
    return this.byUser.get(id) ?? new Set();
  }
  session(id) {
    return this.bySession.get(id) ?? new Set();
  }
  closeSession(id, reason = 'session.revoked') {
    const offlineUserIds = [];
    for (const c of [...this.session(id)]) {
      if (this.remove(c)) offlineUserIds.push(c.userId);
      try {
        if (c.socket.readyState === 1) c.socket.send(JSON.stringify(envelope(reason, {})));
        if (c.socket.readyState < 2) c.socket.close(4001, reason);
      } catch {
        try {
          c.socket.terminate();
        } catch {
          /* already closed */
        }
      }
    }
    return offlineUserIds;
  }
}
export const envelope = (event, data) => ({
  event,
  eventId: randomUUID(),
  timestamp: new Date().toISOString(),
  data,
});
