import { create } from 'zustand'
import {
  DEFAULT_WORKSPACE,
  clearWorkspaceSession,
  normalizeWorkspace,
  readWorkspaceSession,
  syncWorkspaceHistory,
  workspaceEquals,
  writeWorkspaceSession,
} from '@/lib/workspace'

const initialWorkspace = normalizeWorkspace(readWorkspaceSession() ?? DEFAULT_WORKSPACE)

export const useUiStore = create((set, get) => ({
  workspaceView: initialWorkspace.view,
  activeConversationId: initialWorkspace.conversationId,
  openWorkspace: (partial, { history = 'push', allowAdmin = false } = {}) => {
    const current = { view: get().workspaceView, conversationId: get().activeConversationId }
    const next = normalizeWorkspace(
      {
        view: partial.view ?? current.view,
        conversationId: partial.conversationId === undefined ? current.conversationId : partial.conversationId,
      },
      { allowAdmin },
    )
    if (workspaceEquals(current, next)) {
      writeWorkspaceSession(next)
      return next
    }
    set({
      workspaceView: next.view,
      activeConversationId: next.conversationId,
      replyTo: next.conversationId === current.conversationId ? get().replyTo : null,
      editingMessage: next.conversationId === current.conversationId ? get().editingMessage : null,
      groupPanelOpen: next.view === 'chats' && next.conversationId === current.conversationId ? get().groupPanelOpen : false,
      addMembersOpen: false,
      emojiOpen: false,
    })
    writeWorkspaceSession(next)
    syncWorkspaceHistory(next, history)
    return next
  },
  hydrateWorkspace: (partial, { allowAdmin = false } = {}) => {
    const next = normalizeWorkspace(partial, { allowAdmin })
    set({
      workspaceView: next.view,
      activeConversationId: next.conversationId,
    })
    writeWorkspaceSession(next)
    return next
  },
  resetWorkspace: () => {
    set({
      workspaceView: DEFAULT_WORKSPACE.view,
      activeConversationId: DEFAULT_WORKSPACE.conversationId,
      replyTo: null,
      editingMessage: null,
      forwardingMessage: null,
      groupPanelOpen: false,
      addMembersOpen: false,
      emojiOpen: false,
    })
    clearWorkspaceSession()
  },
  mobileNavOpen: false,
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  conversationFilter: 'all',
  setConversationFilter: (conversationFilter) => set({ conversationFilter }),
  conversationQuery: '',
  setConversationQuery: (conversationQuery) => set({ conversationQuery }),
  replyTo: null,
  setReplyTo: (replyTo) => set({ replyTo }),
  editingMessage: null,
  setEditingMessage: (editingMessage) => set({ editingMessage }),
  forwardingMessage: null,
  setForwardingMessage: (forwardingMessage) => set({ forwardingMessage }),
  groupPanelOpen: false,
  setGroupPanelOpen: (groupPanelOpen) => set({ groupPanelOpen }),
  addMembersOpen: false,
  setAddMembersOpen: (addMembersOpen) => set({ addMembersOpen }),
  emojiOpen: false,
  setEmojiOpen: (emojiOpen) => set({ emojiOpen }),
  connectionStatus: 'idle',
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}))

export const usePresenceStore = create((set, get) => ({
  online: {},
  setOnline: (userId, online) =>
    set({
      online: { ...get().online, [userId]: online },
    }),
  isOnline: (userId) => Boolean(get().online[userId]),
}))

export const useTypingStore = create((set, get) => ({
  byConversation: {},
  setTyping: (conversationId, userId, typing) => {
    if (!conversationId || !userId) return
    const current = new Set(get().byConversation[conversationId] ?? [])
    if (typing) current.add(userId)
    else current.delete(userId)
    set({
      byConversation: {
        ...get().byConversation,
        [conversationId]: [...current],
      },
    })
  },
  typingUserIds: (conversationId) => get().byConversation[conversationId] ?? [],
}))
