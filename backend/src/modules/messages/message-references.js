import { and, eq, isNull } from 'drizzle-orm';
import { conversationMembers, messages } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';

export async function assertReplyTo(tx, { conversation, userId, replyToMessageId }) {
  if (!replyToMessageId) return;
  const [reply] = await tx.select().from(messages).where(eq(messages.id, replyToMessageId));
  if (!reply || reply.deletedAt || reply.expiredAt) {
    throw new AppError('Referenced message unavailable', 400, 'INVALID_REFERENCE');
  }
  if (reply.conversationId === conversation.id) return;
  if (conversation.type !== 'direct' || !reply.senderId || reply.senderId === userId) {
    throw new AppError('Referenced message unavailable', 400, 'INVALID_REFERENCE');
  }
  const [sourceMember] = await tx
    .select()
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.conversationId, reply.conversationId),
        eq(conversationMembers.userId, userId),
        isNull(conversationMembers.leftAt),
      ),
    );
  if (!sourceMember) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
  const peers = await tx
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversation.id), isNull(conversationMembers.leftAt)));
  const other = peers.find((row) => row.userId !== userId);
  if (!other || other.userId !== reply.senderId) {
    throw new AppError('Referenced message unavailable', 400, 'INVALID_REFERENCE');
  }
}
