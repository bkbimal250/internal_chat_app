import { AppError } from '../../utils/app-error.js';

export const GROUP_POLICIES = ['all', 'admins'];

export function groupSettings(conversation = {}) {
  return {
    editInfo: conversation.editInfoPolicy === 'all' ? 'all' : 'admins',
    sendMessages: conversation.sendMessagesPolicy === 'admins' ? 'admins' : 'all',
    addMembers: conversation.addMembersPolicy === 'all' ? 'all' : 'admins',
  };
}

export function isGroupStaff(role) {
  return role === 'owner' || role === 'admin';
}

export function canEditGroupInfo(role, settings) {
  if (role === 'owner') return true;
  if (!role) return false;
  return settings.editInfo === 'all' ? role === 'admin' || role === 'member' : role === 'admin';
}

export function canSendInGroup(role, settings) {
  if (!role) return false;
  return settings.sendMessages === 'all' ? true : isGroupStaff(role);
}

export function canAddGroupMembers(role, settings) {
  if (role === 'owner') return true;
  if (!role) return false;
  return settings.addMembers === 'all' ? role === 'admin' || role === 'member' : role === 'admin';
}

export function presentGroup(conversation) {
  if (!conversation) return conversation;
  const {
    avatarReference,
    editInfoPolicy,
    sendMessagesPolicy,
    addMembersPolicy,
    ...rest
  } = conversation;
  return {
    ...rest,
    hasAvatar: Boolean(avatarReference),
    avatarVersion: conversation.updatedAt instanceof Date ? conversation.updatedAt.toISOString() : conversation.updatedAt,
    settings: groupSettings(conversation),
  };
}

export function assertGroupSend(conversation, role) {
  if (conversation?.type !== 'group') return;
  if (!canSendInGroup(role, groupSettings(conversation))) {
    throw new AppError('Only group admins can send messages', 403, 'GROUP_SEND_RESTRICTED');
  }
}

export function parsePolicy(value, fallback) {
  if (value === undefined) return fallback;
  if (!GROUP_POLICIES.includes(value)) {
    throw new AppError('Invalid group permission', 400, 'INVALID_GROUP_PERMISSION');
  }
  return value;
}
