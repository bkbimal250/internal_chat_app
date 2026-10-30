import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { attachments, conversations, conversationMembers, messages } from '../../database/schema/index.js';
import { attachmentsService } from '../attachments/attachments.service.js';
import { AppError } from '../../utils/app-error.js';
import { conversationService } from '../conversations/conversations.service.js';

const EDIT_WINDOW_MS = 15 * 60000;

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
    if (!message || message.senderId !== userId || message.deletedAt || !types.includes(message.messageType)) {
      throw new AppError('Message not found', 404, 'NOT_FOUND');
    }
    const [membership] = await activeMember(tx, message.conversationId, userId);
    if (!membership) throw new AppError('Message not found', 404, 'NOT_FOUND');
    return message;
  };
  return {
    async get(id, userId) {
      const message = await messageFor(id);
      if (!message) throw new AppError('Message not found', 404, 'NOT_FOUND');
      await conversationsService.assertMember(message.conversationId, userId);
      return files.hydrate(message);
    },
    async list(conversationId, userId, afterSeq, limit) {
      await conversationsService.assertMember(conversationId, userId);
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            Number.isInteger(afterSeq) ? gt(messages.sequenceNumber, afterSeq) : undefined,
          ),
        )
        .orderBy(asc(messages.sequenceNumber))
        .limit(limit + 1);
      return {
        data: await files.hydrateMany(rows.slice(0, limit)),
        nextAfterSeq: rows.length > limit ? rows[limit - 1].sequenceNumber : null,
      };
    },
    async sync(conversationId, userId, afterChangeSeq, limit) {
      const { conversation } = await conversationsService.assertMember(conversationId, userId);
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            Number.isInteger(afterChangeSeq) ? gt(messages.changeSeq, afterChangeSeq) : undefined,
          ),
        )
        .orderBy(asc(messages.changeSeq))
        .limit(limit + 1);
      return {
        data: await files.hydrateMany(rows.slice(0, limit)),
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
        if (input.replyToMessageId) {
          const [reply] = await tx
            .select()
            .from(messages)
            .where(
              and(
                eq(messages.id, input.replyToMessageId),
                eq(messages.conversationId, conversationId),
                isNull(messages.deletedAt),
              ),
            );
          if (!reply) throw new AppError('Referenced message unavailable', 400, 'INVALID_REFERENCE');
        }
        if (input.forwardedFromMessageId) {
          const [source] = await tx
            .select()
            .from(messages)
            .where(and(eq(messages.id, input.forwardedFromMessageId), isNull(messages.deletedAt)));
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
          })
          .returning();
        return { message, duplicate: false };
      });
    },
    async edit(id, userId, content) {
      const trimmed = requireContent(content);
      return db.transaction(async (tx) => {
        const message = await loadOwned(tx, id, userId, ['text']);
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
      return db.transaction(async (tx) => {
        const message = await loadOwned(tx, id, userId, ['text', 'image', 'video', 'audio', 'file']);
        if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
          throw new AppError('Delete window expired', 403, 'DELETE_WINDOW_EXPIRED');
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
      }).then(async ({ updated, file }) => {
        if (file) await app.storage.remove(file.storageKey).catch(() => {});
        return updated;
      });
    },
  };
}
