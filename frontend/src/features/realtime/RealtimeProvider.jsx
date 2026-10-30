import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { websocketManager } from '@/services/websocket'
import { applyRealtimeEvent } from '@/lib/realtime-events'
import { queryKeys } from '@/lib/query-keys'
import { messagesApi, receiptsApi } from '@/services/api'
import { refreshAccessToken } from '@/services/api-client'
import { applySyncRecords, newestChangeSeq, newestSequence, upsertMessage } from '@/lib/messages'
import { useAuth } from '@/hooks/use-auth'
import { usePresenceStore, useTypingStore, useUiStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'

export function RealtimeProvider({ children }) {
  const { isAuthenticated, mustChangePassword } = useAuth()
  const queryClient = useQueryClient()
  const setConnectionStatus = useUiStore((state) => state.setConnectionStatus)
  const setOnline = usePresenceStore((state) => state.setOnline)
  const setTyping = useTypingStore((state) => state.setTyping)
  const openRef = useRef(false)

  useEffect(() => {
    const unsubStatus = websocketManager.subscribeStatus(async (status) => {
      setConnectionStatus(status)
      if (status !== 'unauthorized') return
      try {
        const payload = await refreshAccessToken()
        useAuthStore.getState().hydrate(payload)
        websocketManager.connect()
      } catch {
        useAuthStore.getState().reset()
      }
    })
    const unsubscribe = websocketManager.subscribe(async (event) => {
      applyRealtimeEvent(event, {
        currentUserId: useAuthStore.getState().user?.id,
        onTyping: setTyping,
        onPresence: setOnline,
        onRevoked: () => useAuthStore.getState().reset(),
      })

      if (event.event === 'connection.ready' && openRef.current) {
        const conversationQueries = queryClient.getQueriesData({ queryKey: ['messages'] })
        for (const [key, value] of conversationQueries) {
          const conversationId = key[1]
          if (!conversationId || !value?.data) continue
          try {
            const synced = await messagesApi.sync(conversationId, {
              afterChangeSeq: newestChangeSeq(value.data),
              limit: 100,
            })
            queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
              ...current,
              data: applySyncRecords(current?.data ?? [], synced.data ?? []),
            }))
            const afterSeq = newestSequence(
              queryClient.getQueryData(queryKeys.messages(conversationId))?.data,
            )
            const fresh = await messagesApi.list(conversationId, { afterSeq, limit: 100 })
            queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
              ...current,
              data: (fresh.data ?? []).reduce(
                (list, message) => upsertMessage(list, message),
                current?.data ?? [],
              ),
            }))
            const receipts = await receiptsApi.conversation(conversationId)
            queryClient.setQueryData(queryKeys.receipts(conversationId), receipts)
            queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) })
          } catch {
            queryClient.invalidateQueries({ queryKey: queryKeys.messages(conversationId) })
          }
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
      }

      if (event.event === 'connection.ready') openRef.current = true
    })

    return () => {
      unsubscribe()
      unsubStatus()
    }
  }, [queryClient, setConnectionStatus, setOnline, setTyping])

  useEffect(() => {
    if (isAuthenticated && !mustChangePassword) {
      openRef.current = false
      websocketManager.connect()
      return () => websocketManager.disconnect()
    }
    websocketManager.disconnect()
    return undefined
  }, [isAuthenticated, mustChangePassword])

  return children
}
