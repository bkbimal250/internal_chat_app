import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { websocketManager } from '@/services/websocket'
import { useAuthStore } from '@/stores/auth-store'
import { useUiStore } from '@/stores/ui-store'
import { queryClient } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'
import { conversationTitle, isMuted } from '@/lib/conversations'
import { shouldNotifyIncomingMessage } from '@/lib/notify-incoming'
import { previewText } from '@/lib/conversations'
import { findConversation } from '@/lib/conversation-actions'

export function MessageNotifyHost() {
  const seen = useRef(new Set())

  useEffect(() => {
    return websocketManager.subscribe((event) => {
      if (event?.event !== 'message.created') return
      const message = event.data || {}
      const currentUserId = useAuthStore.getState().user?.id
      const notify = shouldNotifyIncomingMessage({
        message,
        currentUserId,
        viewedConversationId: useUiStore.getState().activeConversationId,
        documentVisible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
        documentFocused: typeof document === 'undefined' ? true : typeof document.hasFocus === 'function' ? document.hasFocus() : true,
        seen: seen.current,
      })
      if (!notify) return
      const conversation = findConversation(
        [
          queryClient.getQueryData(queryKeys.conversations)?.data,
          queryClient.getQueryData(queryKeys.archivedConversations)?.data,
        ],
        message.conversationId,
      )
      if (isMuted(conversation)) return
      const title = conversationTitle(conversation, currentUserId) || 'MiChat'
      const body = previewText(message) || 'New message'
      toast(title, { description: body, duration: 4000 })
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(title, { body, tag: message.id })
        } catch {
          /* ignore blocked browser notifications */
        }
      }
    })
  }, [])

  return null
}
