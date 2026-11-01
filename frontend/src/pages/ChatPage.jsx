import { ConversationSidebar } from '@/features/conversations/ConversationSidebar'
import { MessagePane } from '@/features/messages/MessagePane'
import { EmptyState } from '@/components/common/EmptyState'
import { MessageSquare } from 'lucide-react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useWorkspace } from '@/hooks/use-workspace'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

const SIDEBAR_LAYOUT_KEY = 'company-chat.sidebar-layout'

function loadSidebarLayout() {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(SIDEBAR_LAYOUT_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.chats === 'number' && typeof parsed.thread === 'number') return parsed
  } catch {
    return undefined
  }
  return undefined
}

function saveSidebarLayout(layout) {
  try {
    window.localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    // Ignore quota or private-mode failures.
  }
}

export function ChatPage() {
  const { conversationId } = useWorkspace()
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const thread = conversationId ? (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <MessagePane conversationId={conversationId} />
    </div>
  ) : (
    <div className="hidden h-full min-w-0 flex-1 md:flex">
      <EmptyState
        icon={MessageSquare}
        title="Select a conversation"
        description="Choose a colleague or group from the list, or start a new chat."
      />
    </div>
  )

  if (!isDesktop) {
    return (
      <div className="flex h-full min-h-0" data-testid="chat-workspace">
        <ConversationSidebar />
        {conversationId ? thread : null}
      </div>
    )
  }

  return (
    <div className="h-full min-h-0" data-testid="chat-workspace">
      <ResizablePanelGroup
        id="chat-workspace-panels"
        orientation="horizontal"
        defaultLayout={loadSidebarLayout()}
        onLayoutChanged={(layout, meta) => {
          if (meta?.isUserInteraction) saveSidebarLayout(meta.requestedLayout ?? layout)
        }}
      >
        <ResizablePanel
          id="chats"
          minSize={240}
          maxSize={560}
          defaultSize={360}
          className="h-full"
        >
          <ConversationSidebar />
        </ResizablePanel>
        <ResizableHandle data-testid="sidebar-resize-handle" aria-label="Resize chat list" />
        <ResizablePanel id="thread" minSize={280} className="h-full">
          {thread}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
