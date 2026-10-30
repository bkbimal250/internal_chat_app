import { describe, expect, it } from 'vitest'
import { canChangeRole, canManageGroup, canRemoveMember, canTransferOwnership } from '@/lib/permissions'

describe('group permissions', () => {
  it('lets owners and admins manage members with owner-only role changes', () => {
    expect(canManageGroup('owner')).toBe(true)
    expect(canManageGroup('admin')).toBe(true)
    expect(canManageGroup('member')).toBe(false)
    expect(canChangeRole('owner', 'admin')).toBe(true)
    expect(canChangeRole('admin', 'member')).toBe(false)
    expect(canRemoveMember('admin', 'member', false)).toBe(true)
    expect(canRemoveMember('admin', 'owner', false)).toBe(false)
    expect(canRemoveMember('member', 'member', true)).toBe(true)
    expect(canTransferOwnership('owner')).toBe(true)
    expect(canTransferOwnership('admin')).toBe(false)
  })
})
