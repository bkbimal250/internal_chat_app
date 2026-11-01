import { lazy, Suspense, useEffect } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useUiStore } from '@/stores/ui-store'
import { DEFAULT_WORKSPACE, normalizeWorkspace, syncWorkspaceHistory } from '@/lib/workspace'
import { ChatPage } from '@/pages/ChatPage'

const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)
const DirectoryPage = lazy(() =>
  import('@/pages/DirectoryPage').then((module) => ({ default: module.DirectoryPage })),
)
const GroupsPage = lazy(() => import('@/pages/GroupsPage').then((module) => ({ default: module.GroupsPage })))
const AdminDashboardPage = lazy(() =>
  import('@/pages/AdminDashboardPage').then((module) => ({ default: module.AdminDashboardPage })),
)

function ScreenFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

export function WorkspaceShell() {
  const { isAdmin } = useAuth()
  const view = useUiStore((state) => state.workspaceView)
  const conversationId = useUiStore((state) => state.activeConversationId)
  const hydrateWorkspace = useUiStore((state) => state.hydrateWorkspace)
  const resolved = view === 'admin' && !isAdmin ? 'chats' : view

  useEffect(() => {
    const current = { view, conversationId }
    const next = normalizeWorkspace(current, { allowAdmin: isAdmin })
    if (next.view !== view) hydrateWorkspace(next, { allowAdmin: isAdmin })
    if (!window.history.state?.workspace) syncWorkspaceHistory(next, 'replace')
  }, [conversationId, hydrateWorkspace, isAdmin, view])

  useEffect(() => {
    function onPopState(event) {
      hydrateWorkspace(event.state?.workspace ?? DEFAULT_WORKSPACE, { allowAdmin: isAdmin })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [hydrateWorkspace, isAdmin])

  let screen = <ChatPage />
  if (resolved === 'directory') screen = <DirectoryPage />
  else if (resolved === 'groups') screen = <GroupsPage />
  else if (resolved === 'settings') screen = <SettingsPage />
  else if (resolved === 'admin' && isAdmin) screen = <AdminDashboardPage />

  return <Suspense fallback={<ScreenFallback />}>{screen}</Suspense>
}
