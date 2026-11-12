import { and, desc, eq, gt, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  conversations,
  conversationMembers,
  directConversationPairs,
  messages,
  users,
} from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { presentGroup } from '../groups/group-permissions.js';

export const MAX_PINNED = 3;
export const MAX_BULK = 50;

export const memberWhere = (id, userId) =>
  and(
    eq(conversationMembers.conversationId, id),
    eq(conversationMembers.userId, userId),
    isNull(conversationMembers.leftAt),
  );

function iso(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

export function selectedIds(ids) {
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === 'string' && id.length > 0))];
  if (!unique.length) throw new AppError('Select at least one chat', 400, 'EMPTY_SELECTION');
  if (unique.length > MAX_BULK) throw new AppError('Too many chats selected', 400, 'TOO_MANY');
  return unique;
}

async function mapSelected(ids, worker) {
  const unique = selectedIds(ids);
  const updated = [];
  const failed = [];
  for (const id of unique) {
    try {
      updated.push(await worker(id));
    } catch (error) {
      failed.push({
        id,
        code: error.code || 'FAILED',
        message: error.message || 'Unable to update chat',
      });
    }
  }
  return { updated, failed };
}

export const visibleToMember = or(
  isNull(conversationMembers.hiddenUntilSeq),
  gt(conversations.lastMessageSeq, conversationMembers.hiddenUntilSeq),
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
    async list(userId, after, limit, { archived = false } = {}) {
      const membership = and(
        eq(conversationMembers.userId, userId),
        isNull(conversationMembers.leftAt),
        visibleToMember,
        archived ? isNotNull(conversationMembers.archivedAt) : isNull(conversationMembers.archivedAt),
      );
      const pinned =
        archived || after
          ? []
          : await db
              .select({ conversation: conversations, member: conversationMembers })
              .from(conversationMembers)
              .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
              .where(and(membership, isNotNull(conversationMembers.pinnedAt)))
              .orderBy(desc(conversationMembers.pinnedAt), desc(conversations.updatedAt))
              .limit(MAX_PINNED);
      const rows = await db
        .select({ conversation: conversations, member: conversationMembers })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(
          and(
            membership,
            archived ? undefined : isNull(conversationMembers.pinnedAt),
            after ? lt(conversations.updatedAt, new Date(after)) : undefined,
          ),
        )
        .orderBy(desc(conversations.updatedAt))
        .limit(limit + 1);
      const page = [...pinned, ...rows.slice(0, limit)];
      const data = await Promise.all(
        page.map(async ({ conversation, member }) => {
          const hidden = sql`not exists (
            select 1 from message_hides
            where message_hides.message_id = ${messages.id}
              and message_hides.user_id = ${userId}::uuid
          )`;
          const afterHide =
            member.hiddenUntilSeq == null
              ? undefined
              : sql`${messages.sequenceNumber} > ${member.hiddenUntilSeq}`;
          const unreadFloor = Math.max(member.lastReadSeq ?? 0, member.hiddenUntilSeq ?? 0);
          const [latest] = await db
            .select()
            .from(messages)
            .where(and(eq(messages.conversationId, conversation.id), hidden, afterHide))
            .orderBy(desc(messages.sequenceNumber))
            .limit(1);
          const [{ count }] = await db
            .select({ count: sql`count(*)::int` })
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conversation.id),
                sql`${messages.sequenceNumber} > ${unreadFloor}`,
                or(isNull(messages.senderId), sql`${messages.senderId} <> ${userId}::uuid`),
                isNull(messages.deletedAt),
                hidden,
                afterHide,
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
            pinnedAt: iso(member.pinnedAt),
            archivedAt: iso(member.archivedAt),
            lastReadSeq: member.lastReadSeq ?? 0,
            lastMessageSeq: conversation.lastMessageSeq ?? 0,
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
    async hide(id, userId) {
      const { conversation } = await this.assertMember(id, userId);
      const hiddenUntilSeq = conversation.lastMessageSeq ?? 0;
      await db
        .update(conversationMembers)
        .set({ hiddenUntilSeq })
        .where(memberWhere(id, userId));
      return { id, hiddenUntilSeq, success: true };
    },
    async hideMany(userId, ids) {
      const { updated, failed } = await mapSelected(ids, (id) => this.hide(id, userId));
      return { hidden: updated, failed };
    },
    async pin(id, userId, pinned) {
      const { member } = await this.assertMember(id, userId);
      if (pinned) {
        if (!member.pinnedAt) {
          const [{ n }] = await db
            .select({ n: sql`count(*)::int` })
            .from(conversationMembers)
            .where(
              and(
                eq(conversationMembers.userId, userId),
                isNull(conversationMembers.leftAt),
                isNotNull(conversationMembers.pinnedAt),
                isNull(conversationMembers.archivedAt),
                ne(conversationMembers.conversationId, id),
              ),
            );
          if ((n ?? 0) >= MAX_PINNED) {
            throw new AppError(`You can pin up to ${MAX_PINNED} chats`, 400, 'PIN_LIMIT');
          }
        }
        const [row] = await db
          .update(conversationMembers)
          .set({ pinnedAt: member.pinnedAt ?? new Date(), archivedAt: null })
          .where(memberWhere(id, userId))
          .returning({ pinnedAt: conversationMembers.pinnedAt, archivedAt: conversationMembers.archivedAt });
        return { id, pinned: true, pinnedAt: iso(row?.pinnedAt), archivedAt: null };
      }
      await db.update(conversationMembers).set({ pinnedAt: null }).where(memberWhere(id, userId));
      return { id, pinned: false, pinnedAt: null, archivedAt: iso(member.archivedAt) };
    },
    async pinMany(userId, ids, pinned) {
      const { updated, failed } = await mapSelected(ids, (id) => this.pin(id, userId, pinned));
      return { pinned: updated, failed };
    },
    async archive(id, userId, archived) {
      await this.assertMember(id, userId);
      if (archived) {
        const [row] = await db
          .update(conversationMembers)
          .set({ archivedAt: new Date(), pinnedAt: null })
          .where(memberWhere(id, userId))
          .returning({ archivedAt: conversationMembers.archivedAt });
        return { id, archived: true, archivedAt: iso(row?.archivedAt), pinnedAt: null };
      }
      const [row] = await db
        .update(conversationMembers)
        .set({ archivedAt: null })
        .where(memberWhere(id, userId))
        .returning({ archivedAt: conversationMembers.archivedAt, pinnedAt: conversationMembers.pinnedAt });
      return { id, archived: false, archivedAt: null, pinnedAt: iso(row?.pinnedAt) };
    },
    async archiveMany(userId, ids, archived) {
      const { updated, failed } = await mapSelected(ids, (id) => this.archive(id, userId, archived));
      return { archived: updated, failed };
    },
    async unread(id, userId) {
      const { conversation, member } = await this.assertMember(id, userId);
      const last = conversation.lastMessageSeq ?? 0;
      const floor = member.hiddenUntilSeq ?? 0;
      const lastReadSeq = last > floor ? last - 1 : floor;
      await db.update(conversationMembers).set({ lastReadSeq }).where(memberWhere(id, userId));
      return { id, lastReadSeq, unread: true };
    },
    async unreadMany(userId, ids) {
      const { updated, failed } = await mapSelected(ids, (id) => this.unread(id, userId));
      return { unread: updated, failed };
    },
    async readToLatest(id, userId) {
      const { conversation } = await this.assertMember(id, userId);
      const lastReadSeq = conversation.lastMessageSeq ?? 0;
      await db
        .update(conversationMembers)
        .set({ lastReadSeq: sql`greatest(${conversationMembers.lastReadSeq}, ${lastReadSeq})` })
        .where(memberWhere(id, userId));
      return { id, lastReadSeq, unread: false };
    },
    async readMany(userId, ids) {
      const { updated, failed } = await mapSelected(ids, (id) => this.readToLatest(id, userId));
      return { read: updated, failed };
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
