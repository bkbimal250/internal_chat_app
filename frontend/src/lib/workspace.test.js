import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_STORAGE_KEY,
  clearWorkspaceSession,
  fromLegacyPath,
  isConversationId,
  normalizeWorkspace,
  readWorkspaceSession,
  syncWorkspaceHistory,
  workspaceEquals,
  writeWorkspaceSession,
} from '@/lib/workspace'

const ID = '704b5d93-187f-4a5c-9e15-19d3f85b8224'

afterEach(() => {
  clearWorkspaceSession()
})

describe('workspace navigation', () => {
  it('accepts only real conversation UUIDs', () => {
    expect(isConversationId(ID)).toBe(true)
    expect(isConversationId('not-a-uuid')).toBe(false)
    expect(isConversationId('')).toBe(false)
  })

  it('keeps chats selected and drops admin for regular employees', () => {
    expect(normalizeWorkspace({ view: 'settings', conversationId: ID })).toEqual({
      view: 'settings',
      conversationId: ID,
    })
    expect(normalizeWorkspace({ view: 'admin', conversationId: ID })).toEqual({
      view: 'chats',
      conversationId: ID,
    })
    expect(normalizeWorkspace({ view: 'admin' }, { allowAdmin: true })).toEqual({
      view: 'admin',
      conversationId: null,
    })
  })

  it('maps legacy URLs into workspace state', () => {
    expect(fromLegacyPath('/')).toEqual(DEFAULT_WORKSPACE)
    expect(fromLegacyPath(`/c/${ID}`)).toEqual({ view: 'chats', conversationId: ID })
    expect(fromLegacyPath('/directory')).toEqual({ view: 'directory', conversationId: null })
    expect(fromLegacyPath('/groups')).toEqual({ view: 'groups', conversationId: null })
    expect(fromLegacyPath('/settings')).toEqual({ view: 'settings', conversationId: null })
    expect(fromLegacyPath('/admin')).toEqual({ view: 'admin', conversationId: null })
    expect(fromLegacyPath('/unknown')).toBeNull()
  })

  it('persists only view and conversation id in sessionStorage', () => {
    writeWorkspaceSession({ view: 'directory', conversationId: ID, accessToken: 'secret' })
    expect(sessionStorage.getItem(WORKSPACE_STORAGE_KEY)).not.toContain('secret')
    expect(readWorkspaceSession()).toEqual({ view: 'directory', conversationId: ID })
  })

  it('compares workspace entries', () => {
    expect(workspaceEquals({ view: 'chats', conversationId: ID }, { view: 'chats', conversationId: ID })).toBe(true)
    expect(workspaceEquals({ view: 'chats', conversationId: ID }, { view: 'settings', conversationId: ID })).toBe(false)
  })

  it('keeps the public URL at / when pushing workspace history', () => {
    window.history.replaceState({ idx: 0, key: 'rr' }, '', '/')
    syncWorkspaceHistory({ view: 'settings', conversationId: ID }, 'push')
    expect(window.location.pathname).toBe('/')
    expect(window.history.state.idx).toBe(0)
    expect(window.history.state.workspace).toEqual({ view: 'settings', conversationId: ID })
    expect(JSON.stringify(window.history.state)).not.toContain('secret')
  })
})
