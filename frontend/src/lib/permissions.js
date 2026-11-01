export function memberRole(members, userId) {
  return members?.find((member) => member.id === userId)?.role ?? null
}

export function canManageGroup(role) {
  return role === 'owner' || role === 'admin'
}

export function canChangeRole(actorRole, targetRole) {
  if (targetRole === 'owner') return false
  return actorRole === 'owner'
}

export function canRemoveMember(actorRole, targetRole, isSelf) {
  if (isSelf) return actorRole !== 'owner'
  if (targetRole === 'owner') return false
  if (actorRole === 'owner') return true
  return actorRole === 'admin' && targetRole === 'member'
}

export function canTransferOwnership(actorRole) {
  return actorRole === 'owner'
}

export function groupSettings(conversation) {
  return {
    editInfo: conversation?.settings?.editInfo === 'all' ? 'all' : 'admins',
    sendMessages: conversation?.settings?.sendMessages === 'admins' ? 'admins' : 'all',
    addMembers: conversation?.settings?.addMembers === 'all' ? 'all' : 'admins',
  }
}

export function canEditGroupInfo(role, settings) {
  if (role === 'owner') return true
  if (!role) return false
  return settings.editInfo === 'all' ? role === 'admin' || role === 'member' : role === 'admin'
}

export function canSendGroupMessages(role, settings) {
  if (!role) return false
  return settings.sendMessages === 'all' ? true : role === 'owner' || role === 'admin'
}

export function canAddGroupMembers(role, settings) {
  if (role === 'owner') return true
  if (!role) return false
  return settings.addMembers === 'all' ? role === 'admin' || role === 'member' : role === 'admin'
}

export function canDeleteEmployee(actor, target) {
  if (!actor || actor.role !== 'admin') return false
  if (!target || target.role !== 'user') return false
  if (target.id === actor.id) return false
  return true
}
