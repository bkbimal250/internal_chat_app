import { useLayoutEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { useUiStore } from '@/stores/ui-store'

export function LegacyRedirect({ view = 'chats' }) {
  const { conversationId } = useParams()
  const { isAdmin } = useAuth()
  const openWorkspace = useUiStore((state) => state.openWorkspace)

  useLayoutEffect(() => {
    openWorkspace({ view, conversationId: conversationId ?? null }, { history: 'none', allowAdmin: isAdmin })
  }, [conversationId, isAdmin, openWorkspace, view])

  return <Navigate to="/" replace />
}
