import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EmptyState } from '@/components/common/EmptyState'
import { MessageSquare } from 'lucide-react'

export function ConversationList() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-4">
        <label className="sr-only" htmlFor="conversation-search">
          Search conversations
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="conversation-search"
            placeholder="Search conversations"
            className="pl-9"
            disabled
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <EmptyState
          icon={MessageSquare}
          title="No conversations yet"
          description="Direct and group threads will appear here once messaging is connected in the next phase."
        />
      </ScrollArea>
    </div>
  )
}
