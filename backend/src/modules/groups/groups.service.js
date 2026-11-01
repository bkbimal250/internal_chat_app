import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { conversations, conversationMembers, messages, users } from '../../database/schema/index.js';
import { AppError } from '../../utils/app-error.js';
import { presentMember } from '../conversations/conversations.service.js';
import { audit } from '../auth/auth.repository.js';
import { groupPhotoService } from '../../services/group-photo.service.js';
import {
  canAddGroupMembers,
  canEditGroupInfo,
  groupSettings,
  parsePolicy,
  presentGroup,
} from './group-permissions.js';

export function groupsService(app, config) {
  const db = app.database.db;
  const photos = groupPhotoService(app, config);
  const activeMember = (tx, id, userId, lock = false) => {
    let query = tx
      .select()
      .from(conversationMembers)
      .where(
        and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId), isNull(conversationMembers.leftAt)),
      );
    return lock ? query.for('update') : query;
  };
  const lockedGroup = async (tx, id) => {
    const [group] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.type, 'group')))
      .for('update');
    if (!group) throw new AppError('Group not found', 404, 'NOT_FOUND');
    return group;
  };
  const requireMember = async (tx, id, userId, lock = false) => {
    const group = lock ? await lockedGroup(tx, id) : (await tx.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.type, 'group'))))[0];
    if (!group) throw new AppError('Group not found', 404, 'NOT_FOUND');
    const [membership] = await activeMember(tx, id, userId, lock);
    if (!membership) throw new AppError('Group membership required', 403, 'FORBIDDEN');
    return { group, membership };
  };
  const manage = async (tx, id, userId, owner = false) => {
    const { group, membership } = await requireMember(tx, id, userId, true);
    if (owner ? membership.role !== 'owner' : !['owner', 'admin'].includes(membership.role)) {
      throw new AppError('Group permission required', 403, 'FORBIDDEN');
    }
    return { group, membership };
  };
  const systemMessage = async (tx, conversationId, content) => {
    const [conversation] = await tx
      .update(conversations)
      .set({
        lastMessageSeq: sql`${conversations.lastMessageSeq} + 1`,
        lastChangeSeq: sql`${conversations.lastChangeSeq} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId))
      .returning({ sequenceNumber: conversations.lastMessageSeq, changeSeq: conversations.lastChangeSeq });
    const [message] = await tx
      .insert(messages)
      .values({
        conversationId,
        sequenceNumber: conversation.sequenceNumber,
        changeSeq: conversation.changeSeq,
        messageType: 'system',
        content,
      })
      .returning();
    return message;
  };
  const memberList = async (id) =>
    (
      await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          fullName: users.fullName,
          role: conversationMembers.role,
          profilePhotoKey: users.profilePhotoKey,
          updatedAt: users.updatedAt,
        })
        .from(conversationMembers)
        .innerJoin(users, eq(users.id, conversationMembers.userId))
        .where(and(eq(conversationMembers.conversationId, id), isNull(conversationMembers.leftAt)))
    ).map(presentMember);

  return {
    async create(userId, input) {
      return db.transaction(async (tx) => {
        const [conversation] = await tx
          .insert(conversations)
          .values({
            type: 'group',
            title: input.title,
            description: input.description ?? null,
            createdBy: userId,
          })
          .returning();
        await tx.insert(conversationMembers).values({ conversationId: conversation.id, userId, role: 'owner' });
        const message = await systemMessage(tx, conversation.id, 'Group created');
        return { conversation: presentGroup({ ...conversation, lastMessageSeq: message.sequenceNumber }), message };
      });
    },
    async details(id, userId) {
      const [membership] = await activeMember(db, id, userId);
      if (!membership) throw new AppError('Group membership required', 403, 'FORBIDDEN');
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.type, 'group')));
      if (!conversation) throw new AppError('Group not found', 404, 'NOT_FOUND');
      return { ...presentGroup(conversation), membership, members: await memberList(id) };
    },
    async list(userId) {
      return db
        .select({ conversation: conversations })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(and(eq(conversationMembers.userId, userId), eq(conversations.type, 'group'), isNull(conversationMembers.leftAt)))
        .orderBy(desc(conversations.updatedAt))
        .then((rows) => rows.map(({ conversation }) => presentGroup(conversation)));
    },
    async members(id, userId) {
      return (await this.details(id, userId)).members;
    },
    async update(id, userId, input) {
      return db.transaction(async (tx) => {
        const { group, membership } = await requireMember(tx, id, userId, true);
        if (!canEditGroupInfo(membership.role, groupSettings(group))) {
          throw new AppError('Group permission required', 403, 'FORBIDDEN');
        }
        const [conversation] = await tx
          .update(conversations)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(conversations.id, id))
          .returning();
        return presentGroup(conversation);
      });
    },
    async updateSettings(id, userId, input, context) {
      return db.transaction(async (tx) => {
        await manage(tx, id, userId, true);
        const next = {
          editInfoPolicy: parsePolicy(input.editInfo, undefined),
          sendMessagesPolicy: parsePolicy(input.sendMessages, undefined),
          addMembersPolicy: parsePolicy(input.addMembers, undefined),
          updatedAt: new Date(),
        };
        Object.keys(next).forEach((key) => {
          if (next[key] === undefined) delete next[key];
        });
        const [conversation] = await tx.update(conversations).set(next).where(eq(conversations.id, id)).returning();
        await audit(tx, context, 'group.settings_updated', 'conversation', id, { fields: Object.keys(input) });
        return presentGroup(conversation);
      });
    },
    async add(id, userId, targetUserId) {
      return db.transaction(async (tx) => {
        const { group, membership } = await requireMember(tx, id, userId, true);
        if (!canAddGroupMembers(membership.role, groupSettings(group))) {
          throw new AppError('Group permission required', 403, 'FORBIDDEN');
        }
        const [employee] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, targetUserId), eq(users.status, 'active'), isNull(users.deletedAt)));
        if (!employee) throw new AppError('Employee not found', 404, 'NOT_FOUND');
        const [existing] = await tx
          .select()
          .from(conversationMembers)
          .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)))
          .for('update');
        if (existing && !existing.leftAt) throw new AppError('Already a member', 409, 'CONFLICT');
        const [{ count }] = await tx
          .select({ count: sql`count(*)::int` })
          .from(conversationMembers)
          .where(and(eq(conversationMembers.conversationId, id), isNull(conversationMembers.leftAt)));
        if (count >= config.groupMemberLimit) throw new AppError('Group member limit reached', 409, 'GROUP_MEMBER_LIMIT_REACHED');
        if (existing) {
          await tx
            .update(conversationMembers)
            .set({ leftAt: null, joinedAt: new Date(), role: 'member', lastReadSeq: 0 })
            .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)));
        } else {
          await tx.insert(conversationMembers).values({ conversationId: id, userId: targetUserId });
        }
        const message = await systemMessage(tx, id, 'A member was added to the group');
        return { userId: targetUserId, message };
      });
    },
    async role(id, userId, targetUserId, role) {
      return db.transaction(async (tx) => {
        await manage(tx, id, userId, true);
        if (targetUserId === userId) throw new AppError('Group permission required', 403, 'FORBIDDEN');
        const [target] = await activeMember(tx, id, targetUserId, true);
        if (!target) throw new AppError('Member not found', 404, 'NOT_FOUND');
        if (target.role === 'owner') throw new AppError('Group permission required', 403, 'FORBIDDEN');
        await tx
          .update(conversationMembers)
          .set({ role })
          .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)));
        const message = await systemMessage(tx, id, `A member is now ${role}`);
        return { userId: targetUserId, role, message };
      });
    },
    async transfer(id, userId, targetUserId) {
      return db.transaction(async (tx) => {
        await manage(tx, id, userId, true);
        if (targetUserId === userId) throw new AppError('Member not found', 404, 'NOT_FOUND');
        const [target] = await activeMember(tx, id, targetUserId, true);
        if (!target) throw new AppError('Member not found', 404, 'NOT_FOUND');
        await tx
          .update(conversationMembers)
          .set({ role: 'admin' })
          .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)));
        await tx
          .update(conversationMembers)
          .set({ role: 'owner' })
          .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)));
        const message = await systemMessage(tx, id, 'Group ownership was transferred');
        return { userId: targetUserId, message };
      });
    },
    async leave(id, userId) {
      return db.transaction(async (tx) => {
        await lockedGroup(tx, id);
        const [membership] = await activeMember(tx, id, userId, true);
        if (!membership) throw new AppError('Group membership required', 403, 'FORBIDDEN');
        if (membership.role === 'owner') throw new AppError('Transfer ownership before leaving', 409, 'OWNER_MUST_TRANSFER');
        await tx
          .update(conversationMembers)
          .set({ leftAt: new Date() })
          .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)));
        const message = await systemMessage(tx, id, 'A member left the group');
        return { userId, message };
      });
    },
    async remove(id, userId, targetUserId) {
      return db.transaction(async (tx) => {
        const { membership: manager } = await manage(tx, id, userId);
        const [target] = await activeMember(tx, id, targetUserId, true);
        if (!target) throw new AppError('Member not found', 404, 'NOT_FOUND');
        if (target.role === 'owner') throw new AppError('Transfer ownership before removing owner', 409, 'OWNER_MUST_TRANSFER');
        if (manager.role === 'admin' && target.role !== 'member') {
          throw new AppError('Group permission required', 403, 'FORBIDDEN');
        }
        await tx
          .update(conversationMembers)
          .set({ leftAt: new Date() })
          .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, targetUserId)));
        const message = await systemMessage(tx, id, 'A member was removed from the group');
        return { userId: targetUserId, message };
      });
    },
    async initPhoto(id, userId, mimeType) {
      return db.transaction(async (tx) => {
        const { group, membership } = await requireMember(tx, id, userId, true);
        if (!canEditGroupInfo(membership.role, groupSettings(group))) {
          throw new AppError('Group permission required', 403, 'FORBIDDEN');
        }
        return photos.init(id, mimeType);
      });
    },
    async completePhoto(id, userId, key, mimeType) {
      const { group, membership } = await requireMember(db, id, userId);
      if (!canEditGroupInfo(membership.role, groupSettings(group))) {
        throw new AppError('Group permission required', 403, 'FORBIDDEN');
      }
      return presentGroup(await photos.complete(id, key, mimeType));
    },
    async removePhoto(id, userId) {
      const { group, membership } = await requireMember(db, id, userId);
      if (!canEditGroupInfo(membership.role, groupSettings(group))) {
        throw new AppError('Group permission required', 403, 'FORBIDDEN');
      }
      return presentGroup(await photos.remove(id));
    },
    async photoUrl(id, userId) {
      const [membership] = await activeMember(db, id, userId);
      if (!membership) throw new AppError('Group membership required', 403, 'FORBIDDEN');
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, id), eq(conversations.type, 'group')));
      if (!conversation) throw new AppError('Group not found', 404, 'NOT_FOUND');
      const url = await photos.url(conversation);
      return { url, photoVersion: conversation.updatedAt instanceof Date ? conversation.updatedAt.toISOString() : conversation.updatedAt };
    },
  };
}
