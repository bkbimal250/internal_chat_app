import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import {
  conversations,
  conversationMembers,
  directConversationPairs,
  messages,
  users,
} from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { presentGroup } from '../groups/group-permissions.js';
export const memberWhere = (id, userId) =>
  and(
    eq(conversationMembers.conversationId, id),
    eq(conversationMembers.userId, userId),
    isNull(conversationMembers.leftAt),
  );

export function presentMember({ profilePhotoKey, updatedAt, ...rest }) {
  return {
    ...rest,
    hasProfilePhoto: Boolean(profilePhotoKey),
    photoVersion: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
}
export function conversationService(app) {
  const db = app.database.db;
  return {
    async direct(userId, otherId) {
      if (userId === otherId)
        throw new AppError('Direct conversations require two accounts', 400, 'INVALID_PARTICIPANT');
      const [a, b] = [userId, otherId].sort();
      return db.transaction(async (tx) => {
        const [other] = await tx
          .select()
          .from(users)
          .where(and(eq(users.id, otherId), eq(users.status, 'active'), isNull(users.deletedAt)));
        if (!other) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        const [found] = await tx
          .select({ id: conversations.id })
          .from(directConversationPairs)
          .innerJoin(conversations, eq(conversations.id, directConversationPairs.conversationId))
          .where(
            and(
              eq(directConversationPairs.canonicalUserId1, a),
              eq(directConversationPairs.canonicalUserId2, b),
            ),
          );
        if (found) return { id: found.id, existing: true };
        try {
          const [c] = await tx
            .insert(conversations)
            .values({ type: 'direct', createdBy: userId })
            .returning();
          await tx
            .insert(directConversationPairs)
            .values({ conversationId: c.id, canonicalUserId1: a, canonicalUserId2: b });
          await tx.insert(conversationMembers).values([
            { conversationId: c.id, userId, role: 'member' },
            { conversationId: c.id, userId: otherId, role: 'member' },
          ]);
          return { id: c.id, existing: false };
        } catch (e) {
          if (e.code !== '23505') throw e;
          const [r] = await tx
            .select({ id: conversations.id })
            .from(directConversationPairs)
            .innerJoin(conversations, eq(conversations.id, directConversationPairs.conversationId))
            .where(
              and(
                eq(directConversationPairs.canonicalUserId1, a),
                eq(directConversationPairs.canonicalUserId2, b),
              ),
            );
          return { id: r.id, existing: true };
        }
      });
    },
    async assertMember(id, userId) {
      const [m] = await db
        .select({ member: conversationMembers, conversation: conversations })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(memberWhere(id, userId));
      if (!m) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
      return m;
    },
    async list(userId, after, limit) {
      const rows = await db
        .select({ conversation: conversations, member: conversationMembers })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(
          and(
            eq(conversationMembers.userId, userId),
            isNull(conversationMembers.leftAt),
            after ? lt(conversations.updatedAt, new Date(after)) : undefined,
          ),
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(limit + 1);
      const data = await Promise.all(
        rows.slice(0, limit).map(async ({ conversation, member }) => {
          const hidden = sql`not exists (
            select 1 from message_hides
            where message_hides.message_id = ${messages.id}
              and message_hides.user_id = ${userId}::uuid
          )`;
          const [latest] = await db
            .select()
            .from(messages)
            .where(and(eq(messages.conversationId, conversation.id), hidden))
            .orderBy(desc(messages.sequenceNumber))
            .limit(1);
          const [{ count }] = await db
            .select({ count: sql`count(*)::int` })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conversation.id),
                sql`${messages.sequenceNumber} > ${member.lastReadSeq}`,
                or(isNull(messages.senderId), sql`${messages.senderId} <> ${userId}::uuid`),
                isNull(messages.deletedAt),
                hidden,
              ),
            );
          const members = (
            await db
              .select({
                id: users.id,
                username: users.username,
                displayName: users.displayName,
                fullName: users.fullName,
                role: conversationMembers.role,
                lastReadSeq: conversationMembers.lastReadSeq,
                profilePhotoKey: users.profilePhotoKey,
                updatedAt: users.updatedAt,
              })
              .from(conversationMembers)
              .innerJoin(users, eq(users.id, conversationMembers.userId))
              .where(
                and(
                  eq(conversationMembers.conversationId, conversation.id),
                  isNull(conversationMembers.leftAt),
                ),
              )
          ).map(presentMember);
          return {
            ...presentGroup(conversation),
            unreadCount: count,
            latestMessage: latest ?? null,
            mutedUntil: member.mutedUntil,
            members,
          };
        }),
      );
      return {
        data,
        nextCursor:
          rows.length > limit ? rows[limit - 1].conversation.updatedAt.toISOString() : null,
      };
    },
    async details(id, userId) {
      const { conversation, member } = await this.assertMember(id, userId);
      const members = (
        await db
          .select({
            id: users.id,
            username: users.username,
            displayName: users.displayName,
            fullName: users.fullName,
            role: conversationMembers.role,
            lastReadSeq: conversationMembers.lastReadSeq,
            joinedAt: conversationMembers.joinedAt,
            profilePhotoKey: users.profilePhotoKey,
            updatedAt: users.updatedAt,
          })
          .from(conversationMembers)
          .innerJoin(users, eq(users.id, conversationMembers.userId))
          .where(and(eq(conversationMembers.conversationId, id), isNull(conversationMembers.leftAt)))
      ).map(presentMember);
      return { ...presentGroup(conversation), membership: member, members };
    },
    async read(id, userId, seq) {
      const { conversation } = await this.assertMember(id, userId);
      if (seq > conversation.lastMessageSeq)
        throw new AppError('Invalid read position', 400, 'INVALID_READ_POSITION');
      await db
        .update(conversationMembers)
        .set({ lastReadSeq: sql`greatest(${conversationMembers.lastReadSeq}, ${seq})` })
        .where(memberWhere(id, userId));
    },
  };
}
