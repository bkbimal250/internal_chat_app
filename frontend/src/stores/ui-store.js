import { create } from 'zustand'

export const useUiStore = create((set) => ({
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
