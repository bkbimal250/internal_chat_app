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
