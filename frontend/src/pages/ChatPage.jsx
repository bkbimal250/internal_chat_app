import { useParams } from 'react-router-dom'
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar'
import { MessagePane } from '@/features/messages/MessagePane'
import { EmptyState } from '@/components/common/EmptyState'
import { MessageSquare } from 'lucide-react'

export function ChatPage() {
  const { conversationId } = useParams()

  return (
    <div className="flex h-full min-h-0" data-testid="chat-workspace">
      <ConversationSidebar />
      {conversationId ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MessagePane conversationId={conversationId} />
        </div>
      ) : (
        <div className="hidden min-w-0 flex-1 md:flex">
          <EmptyState
            icon={MessageSquare}
            title="Select a conversation"
            description="Choose a colleague or group from the list, or start a new chat."
          />
        </div>
      )}
    </div>
  )
}
