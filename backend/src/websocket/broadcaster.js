import { and, eq, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { conversationMembers } from '../database/schema/index.js';
import { envelope } from './connection-manager.js';
export const broadcaster = (app) => ({
  async conversation(id, event, data, { excludeUserId } = {}) {
    const members = await app.database.db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, id), isNull(conversationMembers.leftAt)));
    const text = JSON.stringify(envelope(event, data));
    for (const { userId } of members) {
      if (excludeUserId && userId === excludeUserId) continue;
      for (const c of app.connections.user(userId))
        if (c.socket.readyState === 1) c.socket.send(text);
    }
  },
  user(id, event, data) {
    const text = JSON.stringify(envelope(event, data));
    for (const c of app.connections.user(id)) if (c.socket.readyState === 1) c.socket.send(text);
  },
  async peersOf(userId) {
    const peerMembership = alias(conversationMembers, 'peer_membership');
    return app.database.db
      .selectDistinct({ userId: peerMembership.userId })
      .from(conversationMembers)
      .innerJoin(
        peerMembership,
        eq(conversationMembers.conversationId, peerMembership.conversationId),
      )
      .where(
        and(
          eq(conversationMembers.userId, userId),
          isNull(conversationMembers.leftAt),
          isNull(peerMembership.leftAt),
          ne(peerMembership.userId, userId),
        ),
      );
  },
  sendToUser(userId, text) {
    for (const connection of app.connections.user(userId)) {
      if (connection.socket.readyState === 1) connection.socket.send(text);
    }
  },
  async presence(userId, online) {
    const peers = await this.peersOf(userId);
    const text = JSON.stringify(envelope('presence.updated', { userId, online }));
    for (const peer of peers) this.sendToUser(peer.userId, text);
  },
  async profile(userId, payload) {
    const text = JSON.stringify(envelope('user.updated', payload));
    this.sendToUser(userId, text);
    const peers = await this.peersOf(userId);
    for (const peer of peers) this.sendToUser(peer.userId, text);
  },
  async presenceSnapshot(connection) {
    const peerMembership = alias(conversationMembers, 'peer_membership');
    const peers = await app.database.db
      .selectDistinct({ userId: peerMembership.userId })
      .from(conversationMembers)
      .innerJoin(
        peerMembership,
        eq(conversationMembers.conversationId, peerMembership.conversationId),
      )
      .where(
        and(
          eq(conversationMembers.userId, connection.userId),
          isNull(conversationMembers.leftAt),
          isNull(peerMembership.leftAt),
          ne(peerMembership.userId, connection.userId),
        ),
      );
    for (const peer of peers) {
      if (!app.connections.user(peer.userId).size) continue;
      if (connection.socket.readyState === 1) {
        connection.socket.send(
          JSON.stringify(envelope('presence.updated', { userId: peer.userId, online: true })),
        );
      }
    }
  },
});
