import { useAuth } from '@/hooks/use-auth'
import { useUiStore } from '@/stores/ui-store'

export function useWorkspace() {
  const { isAdmin } = useAuth()
  const view = useUiStore((state) => state.workspaceView)
  const conversationId = useUiStore((state) => state.activeConversationId)
  const openWorkspace = useUiStore((state) => state.openWorkspace)

  return {
    view,
    conversationId,
    openChat: (id, options) =>
      openWorkspace({ view: 'chats', conversationId: id ?? null }, { allowAdmin: isAdmin, ...options }),
    closeChat: (options) =>
      openWorkspace({ view: 'chats', conversationId: null }, { allowAdmin: isAdmin, ...options }),
    openView: (nextView, options) => openWorkspace({ view: nextView }, { allowAdmin: isAdmin, ...options }),
  }
}
