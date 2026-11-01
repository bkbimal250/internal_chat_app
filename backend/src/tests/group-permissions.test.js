import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAddGroupMembers,
  canEditGroupInfo,
  canSendInGroup,
  groupSettings,
  presentGroup,
} from '../modules/groups/group-permissions.js';

test('defaults preserve current group behavior', () => {
  const settings = groupSettings({});
  assert.equal(settings.editInfo, 'admins');
  assert.equal(settings.sendMessages, 'all');
  assert.equal(settings.addMembers, 'admins');
  assert.equal(canEditGroupInfo('member', settings), false);
  assert.equal(canEditGroupInfo('admin', settings), true);
  assert.equal(canSendInGroup('member', settings), true);
  assert.equal(canAddGroupMembers('member', settings), false);
});

test('admins-only messaging and open info edits', () => {
  const settings = groupSettings({ editInfoPolicy: 'all', sendMessagesPolicy: 'admins', addMembersPolicy: 'all' });
  assert.equal(canEditGroupInfo('member', settings), true);
  assert.equal(canSendInGroup('member', settings), false);
  assert.equal(canSendInGroup('admin', settings), true);
  assert.equal(canAddGroupMembers('member', settings), true);
  assert.equal(canEditGroupInfo('owner', settings), true);
});

test('presentGroup hides storage keys and exposes versioned avatar flags', () => {
  const presented = presentGroup({
    id: 'g1',
    title: 'Ops',
    avatarReference: 'avatars/groups/g1/secret.webp',
    editInfoPolicy: 'all',
    sendMessagesPolicy: 'admins',
    addMembersPolicy: 'admins',
    updatedAt: new Date('2026-10-31T00:00:00.000Z'),
  });
  assert.equal(presented.hasAvatar, true);
  assert.equal(presented.avatarVersion, '2026-10-31T00:00:00.000Z');
  assert.equal(presented.avatarReference, undefined);
  assert.deepEqual(presented.settings, { editInfo: 'all', sendMessages: 'admins', addMembers: 'admins' });
});
