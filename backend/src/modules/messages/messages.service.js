import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  attachments,
  conversations,
  conversationMembers,
  messages,
  messageHides,
  messageReactions,
  users,
} from '../../database/schema/index.js';
import { attachmentsService } from '../attachments/attachments.service.js';
import { AppError } from '../../utils/app-error.js';
import { conversationService } from '../conversations/conversations.service.js';
import { assertReplyTo } from './message-references.js';
import { expiresAtForInsert } from '../retention/expires-at.js';
import { assertGroupSend } from '../groups/group-permissions.js';

const EDIT_WINDOW_MS = 15 * 60000;
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const notHiddenBy = (userId) =>
  sql`not exists (
    select 1 from message_hides
    where message_hides.message_id = ${messages.id}
      and message_hides.user_id = ${userId}::uuid
  )`;

function groupReactions(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.emoji) ?? { emoji: row.emoji, count: 0, userIds: [] };
    current.count += 1;
    current.userIds.push(row.userId);
    grouped.set(row.emoji, current);
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export function messagesService(app) {
  const db = app.database.db;
  const conversationsService = conversationService(app);
  const files = attachmentsService(app);
  const messageFor = (id) =>
    db
      .select()
      .from(messages)
      .where(eq(messages.id, id))
      .then(([x]) => x);
  const requireContent = (content) => {
    const trimmed = content.trim();
    if (!trimmed) throw new AppError('Message content is required', 400, 'VALIDATION_ERROR');
    return trimmed;
  };
  const activeMember = (tx, conversationId, userId) =>
    tx
      .select()
      .from(conversationMembers)
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, userId),
          isNull(conversationMembers.leftAt),
        ),
      )
      .for('update');
  const loadOwned = async (tx, id, userId, types = ['text']) => {
    const [message] = await tx.select().from(messages).where(eq(messages.id, id)).for('update');
    if (
      !message ||
      message.senderId !== userId ||
      message.deletedAt ||
      message.expiredAt ||
      !types.includes(message.messageType)
    ) {
      throw new AppError('Message not found', 404, 'NOT_FOUND');
    }
    const [membership] = await activeMember(tx, message.conversationId, userId);
    if (!membership) throw new AppError('Message not found', 404, 'NOT_FOUND');
    return message;
  };
  const decorate = async (rows, _userId) => {
    if (!rows.length) return rows;
    const ids = rows.map((row) => row.id);
    const replyIds = [...new Set(rows.map((row) => row.replyToMessageId).filter(Boolean))];
    const [reactionRows, replyRows] = await Promise.all([
      db.select().from(messageReactions).where(inArray(messageReactions.messageId, ids)),
      replyIds.length
        ? db
            .select({
              id: messages.id,
              senderId: messages.senderId,
              senderName: users.displayName,
              content: messages.content,
              messageType: messages.messageType,
              deletedAt: messages.deletedAt,
              expiredAt: messages.expiredAt,
            })
            .from(messages)
            .leftJoin(users, eq(users.id, messages.senderId))
            .where(inArray(messages.id, replyIds))
        : [],
    ]);
    const reactionsByMessage = new Map();
    for (const row of reactionRows) {
      const list = reactionsByMessage.get(row.messageId) ?? [];
      list.push(row);
      reactionsByMessage.set(row.messageId, list);
    }
    const replies = new Map(replyRows.map((row) => [row.id, row]));
    return rows.map((row) => {
      const quoted = row.replyToMessageId ? replies.get(row.replyToMessageId) : null;
      return {
        ...row,
        reactions: groupReactions(reactionsByMessage.get(row.id) ?? []),
        replyTo: quoted
          ? {
              id: quoted.id,
              senderId: quoted.senderId,
              senderName: quoted.senderName,
              content: quoted.deletedAt || quoted.expiredAt ? '' : quoted.content,
              messageType: quoted.messageType,
              deletedAt: quoted.deletedAt,
              expiredAt: quoted.expiredAt,
            }
          : null,
      };
    });
  };
  return {
    async present(message, userId) {
      if (!message) return message;
      const hydrated =
        message.attachment !== undefined || message.attachments !== undefined
          ? message
          : await files.hydrate(message);
      const [row] = await decorate([hydrated], userId);
      return row;
    },
    async get(id, userId) {
      const message = await messageFor(id);
      if (!message) throw new AppError('Message not found', 404, 'NOT_FOUND');
      const { member } = await conversationsService.assertMember(message.conversationId, userId);
      const [hidden] = await db
        .select({ messageId: messageHides.messageId })
        .from(messageHides)
        .where(and(eq(messageHides.messageId, id), eq(messageHides.userId, userId)));
      if (
        hidden ||
        message.expiredAt ||
        (member.hiddenUntilSeq != null && message.sequenceNumber <= member.hiddenUntilSeq)
      ) {
        throw new AppError('Message not found', 404, 'NOT_FOUND');
      }
      return this.present(message, userId);
    },
    async list(conversationId, userId, afterSeq, limit) {
      const { member } = await conversationsService.assertMember(conversationId, userId);
      const hiddenFloor =
        member.hiddenUntilSeq == null ? undefined : gt(messages.sequenceNumber, member.hiddenUntilSeq);
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            Number.isInteger(afterSeq) ? gt(messages.sequenceNumber, afterSeq) : undefined,
            hiddenFloor,
            isNull(messages.expiredAt),
            notHiddenBy(userId),
          ),
        )
        .orderBy(asc(messages.sequenceNumber))
        .limit(limit + 1);
      return {
        data: await decorate(await files.hydrateMany(rows.slice(0, limit)), userId),
        nextAfterSeq: rows.length > limit ? rows[limit - 1].sequenceNumber : null,
      };
    },
    async sync(conversationId, userId, afterChangeSeq, limit) {
      const { conversation, member } = await conversationsService.assertMember(conversationId, userId);
      const hiddenFloor =
        member.hiddenUntilSeq == null ? undefined : gt(messages.sequenceNumber, member.hiddenUntilSeq);
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            Number.isInteger(afterChangeSeq) ? gt(messages.changeSeq, afterChangeSeq) : undefined,
            hiddenFloor,
            notHiddenBy(userId),
          ),
        )
        .orderBy(asc(messages.changeSeq))
        .limit(limit + 1);
      return {
        data: await decorate(await files.hydrateMany(rows.slice(0, limit)), userId),
        nextAfterChangeSeq: rows.length > limit ? rows[limit - 1].changeSeq : null,
        lastChangeSeq: conversation.lastChangeSeq,
        lastMessageSeq: conversation.lastMessageSeq,
      };
    },
    async create(conversationId, userId, input) {
      const content = requireContent(input.content);
      return db.transaction(async (tx) => {
        const [conversation] = await tx
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .for('update');
        if (!conversation) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
        const [membership] = await activeMember(tx, conversationId, userId);
        if (!membership) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
        assertGroupSend(conversation, membership.role);
        const [duplicate] = await tx
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              eq(messages.clientMessageId, input.clientMessageId),
            ),
          );
        if (duplicate) return { message: duplicate, duplicate: true };
        await assertReplyTo(tx, { conversation, userId, replyToMessageId: input.replyToMessageId });
        if (input.forwardedFromMessageId) {
          const [source] = await tx
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.id, input.forwardedFromMessageId),
                isNull(messages.deletedAt),
                isNull(messages.expiredAt),
              ),
            );
          if (!source || source.messageType !== 'text') {
            throw new AppError('Referenced message unavailable', 400, 'INVALID_REFERENCE');
          }
          const [sourceMember] = await tx
            .select()
            .from(conversationMembers)
            .where(
              and(
                eq(conversationMembers.conversationId, source.conversationId),
                eq(conversationMembers.userId, userId),
                isNull(conversationMembers.leftAt),
              ),
            );
          if (!sourceMember) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
        }
        const [c] = await tx
          .update(conversations)
          .set({
            lastMessageSeq: sql`${conversations.lastMessageSeq} + 1`,
            lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, conversationId))
          .returning();
        const expiresAt = await expiresAtForInsert(tx);
        const [message] = await tx
          .insert(messages)
          .values({
            conversationId,
            senderId: userId,
            clientMessageId: input.clientMessageId,
            sequenceNumber: c.lastMessageSeq,
            changeSeq: c.lastChangeSeq,
            content,
            replyToMessageId: input.replyToMessageId,
            forwardedFromMessageId: input.forwardedFromMessageId,
            expiresAt,
          })
          .returning();
        return { message, duplicate: false };
      });
    },
    async edit(id, userId, content) {
      const trimmed = requireContent(content);
      return db.transaction(async (tx) => {
        const message = await loadOwned(tx, id, userId, ['text']);
        const [conversation] = await tx.select().from(conversations).where(eq(conversations.id, message.conversationId));
        const [membership] = await activeMember(tx, message.conversationId, userId);
        assertGroupSend(conversation, membership?.role);
        if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
          throw new AppError('Edit window expired', 403, 'EDIT_WINDOW_EXPIRED');
        }
        const [c] = await tx
          .update(conversations)
          .set({ lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`, updatedAt: new Date() })
          .where(eq(conversations.id, message.conversationId))
          .returning({ lastChangeSeq: conversations.lastChangeSeq });
        const [updated] = await tx
          .update(messages)
          .set({ content: trimmed, editedAt: new Date(), changeSeq: c.lastChangeSeq })
          .where(and(eq(messages.id, id), isNull(messages.deletedAt)))
          .returning();
        if (!updated) throw new AppError('Message not found', 404, 'NOT_FOUND');
        return updated;
      });
    },
    async remove(id, userId) {
      return db
        .transaction(async (tx) => {
          const message = await loadOwned(tx, id, userId, ['text', 'image', 'video', 'audio', 'file']);
          if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
            throw new AppError('Delete window expired', 403, 'DELETE_WINDOW_EXPIRED');
          }
          const [conversation] = await tx
            .select({ type: conversations.type })
            .from(conversations)
            .where(eq(conversations.id, message.conversationId));
          if (conversation?.type !== 'direct') {
            throw new AppError(
              'Delete for everyone is only available in one-to-one chats',
              403,
              'DELETE_FOR_EVERYONE_NOT_ALLOWED',
            );
          }
          const [c] = await tx
            .update(conversations)
            .set({ lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`, updatedAt: new Date() })
            .where(eq(conversations.id, message.conversationId))
            .returning({ lastChangeSeq: conversations.lastChangeSeq });
          const [updated] = await tx
            .update(messages)
            .set({ deletedAt: new Date(), content: '', changeSeq: c.lastChangeSeq })
            .where(and(eq(messages.id, id), isNull(messages.deletedAt)))
            .returning();
          if (!updated) throw new AppError('Message not found', 404, 'NOT_FOUND');
          await tx.delete(messageReactions).where(eq(messageReactions.messageId, id));
          const [file] = await tx
            .select()
            .from(attachments)
            .where(and(eq(attachments.messageId, updated.id), eq(attachments.status, 'available')));
          if (file) {
            await tx
              .update(attachments)
              .set({ status: 'deleted', deletedAt: new Date() })
              .where(eq(attachments.id, file.id));
          }
          return { updated, file };
        })
        .then(async ({ updated, file }) => {
          if (file) await app.storage.remove(file.storageKey).catch(() => {});
          return updated;
        });
    },
    async hide(id, userId) {
      const message = await messageFor(id);
      if (!message) throw new AppError('Message not found', 404, 'NOT_FOUND');
      await conversationsService.assertMember(message.conversationId, userId);
      if (message.messageType === 'system') throw new AppError('Message not found', 404, 'NOT_FOUND');
      await db.insert(messageHides).values({ messageId: id, userId }).onConflictDoNothing();
      return { id, conversationId: message.conversationId, hidden: true };
    },
    async react(id, userId, emoji) {
      if (!ALLOWED_REACTIONS.includes(emoji)) {
        throw new AppError('Unsupported reaction', 400, 'VALIDATION_ERROR');
      }
      return db.transaction(async (tx) => {
        const [message] = await tx.select().from(messages).where(eq(messages.id, id)).for('update');
        if (!message || message.deletedAt || message.expiredAt || message.messageType === 'system') {
          throw new AppError('Message not found', 404, 'NOT_FOUND');
        }
        const [membership] = await activeMember(tx, message.conversationId, userId);
        if (!membership) throw new AppError('Message not found', 404, 'NOT_FOUND');
        const [existing] = await tx
          .select()
          .from(messageReactions)
          .where(and(eq(messageReactions.messageId, id), eq(messageReactions.userId, userId)));
        if (existing?.emoji === emoji) {
          await tx
            .delete(messageReactions)
            .where(and(eq(messageReactions.messageId, id), eq(messageReactions.userId, userId)));
        } else {
          await tx
            .insert(messageReactions)
            .values({ messageId: id, userId, emoji })
            .onConflictDoUpdate({
              target: [messageReactions.messageId, messageReactions.userId],
              set: { emoji, createdAt: new Date() },
            });
        }
        const [c] = await tx
          .update(conversations)
          .set({ lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`, updatedAt: new Date() })
          .where(eq(conversations.id, message.conversationId))
          .returning({ lastChangeSeq: conversations.lastChangeSeq });
        const [updated] = await tx
          .update(messages)
          .set({ changeSeq: c.lastChangeSeq })
          .where(eq(messages.id, id))
          .returning();
        return updated;
      });
    },
  };
}
