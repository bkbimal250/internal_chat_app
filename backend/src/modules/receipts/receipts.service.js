import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { conversationMembers, messageReceipts, messages } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { conversationService } from '../conversations/conversations.service.js';

export function receiptsService(app) {
  const db = app.database.db;
  const conversations = conversationService(app);
  return {
    async list(messageId, userId) {
      const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
      if (!message || message.deletedAt) throw new AppError('Message unavailable', 404, 'NOT_FOUND');
      await conversations.assertMember(message.conversationId, userId);
      return db.select().from(messageReceipts).where(eq(messageReceipts.messageId, messageId));
    },
    async listConversation(conversationId, userId) {
      await conversations.assertMember(conversationId, userId);
      return db
        .select({
          messageId: messageReceipts.messageId,
          userId: messageReceipts.userId,
          deliveredAt: messageReceipts.deliveredAt,
          readAt: messageReceipts.readAt,
        })
        .from(messageReceipts)
        .innerJoin(messages, eq(messages.id, messageReceipts.messageId))
        .where(eq(messages.conversationId, conversationId));
    },
    async delivered(messageId, userId) {
      return db.transaction(async (tx) => {
        const [message] = await tx
          .select()
          .from(messages)
          .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)));
        if (!message || message.senderId === userId)
          throw new AppError('Message unavailable', 404, 'NOT_FOUND');
        const [member] = await tx
          .select()
          .from(conversationMembers)
          .where(
            and(
              eq(conversationMembers.conversationId, message.conversationId),
              eq(conversationMembers.userId, userId),
              isNull(conversationMembers.leftAt),
            ),
          );
        if (!member) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
        await tx
          .insert(messageReceipts)
          .values({ messageId, userId, deliveredAt: new Date() })
          .onConflictDoUpdate({
            target: [messageReceipts.messageId, messageReceipts.userId],
            set: { deliveredAt: sql`coalesce(${messageReceipts.deliveredAt}, now())` },
          });
        return message;
      });
    },
    async read(conversationId, userId, sequenceNumber) {
      const { conversation } = await conversations.assertMember(conversationId, userId);
      if (sequenceNumber > conversation.lastMessageSeq)
        throw new AppError('Invalid read position', 400, 'INVALID_READ_POSITION');
      await db.transaction(async (tx) => {
        await tx
          .update(conversationMembers)
          .set({
            lastReadSeq: sql`greatest(${conversationMembers.lastReadSeq}, ${sequenceNumber})`,
          })
          .where(
            and(
              eq(conversationMembers.conversationId, conversationId),
              eq(conversationMembers.userId, userId),
            ),
          );
        await tx
          .insert(messageReceipts)
          .select(
            tx
              .select({
                messageId: messages.id,
                userId: sql`${userId}::uuid`,
                deliveredAt: sql`now()`,
                readAt: sql`now()`,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.conversationId, conversationId),
                  gt(messages.sequenceNumber, 0),
                  sql`${messages.sequenceNumber} <= ${sequenceNumber}`,
                  sql`${messages.senderId} <> ${userId}::uuid`,
                  isNull(messages.deletedAt),
                ),
              ),
          )
          .onConflictDoUpdate({
            target: [messageReceipts.messageId, messageReceipts.userId],
            set: {
              deliveredAt: sql`coalesce(${messageReceipts.deliveredAt}, now())`,
              readAt: sql`coalesce(${messageReceipts.readAt}, now())`,
            },
          });
      });
    },
  };
}
