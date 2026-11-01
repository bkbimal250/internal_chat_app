import { describe, expect, it } from 'vitest'
import {
  canAddGroupMembers,
  canChangeRole,
  canDeleteEmployee,
  canEditGroupInfo,
  canManageGroup,
  canRemoveMember,
  canSendGroupMessages,
  canTransferOwnership,
  groupSettings,
} from '@/lib/permissions'

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

  it('applies WhatsApp-style info and send policies', () => {
    const open = groupSettings({ settings: { editInfo: 'all', sendMessages: 'admins', addMembers: 'all' } })
    expect(canEditGroupInfo('member', open)).toBe(true)
    expect(canSendGroupMessages('member', open)).toBe(false)
    expect(canSendGroupMessages('admin', open)).toBe(true)
    expect(canAddGroupMembers('member', open)).toBe(true)
    expect(canEditGroupInfo('member', groupSettings({}))).toBe(false)
  })
})

describe('admin employee deletion', () => {
  const admin = { id: 'admin-1', role: 'admin' }
  const otherAdmin = { id: 'admin-2', role: 'admin' }
  const employee = { id: 'user-1', role: 'user' }

  it('allows administrators to delete USER accounts only', () => {
    expect(canDeleteEmployee(admin, employee)).toBe(true)
    expect(canDeleteEmployee(admin, admin)).toBe(false)
    expect(canDeleteEmployee(admin, otherAdmin)).toBe(false)
    expect(canDeleteEmployee(employee, employee)).toBe(false)
    expect(canDeleteEmployee(employee, admin)).toBe(false)
  })
})
