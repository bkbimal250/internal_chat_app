import { useMemo, useState } from 'react'
import { useWorkspace } from '@/hooks/use-workspace'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Menu, Plus, Search, Users } from 'lucide-react'
import { conversationsApi, usersApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { CreateGroupDialog } from '@/features/groups/CreateGroupDialog'
import { conversationTitle, filterConversations, previewText } from '@/lib/conversations'
import { formatMessageTime } from '@/lib/time'
import { useAuth } from '@/hooks/use-auth'
import { useMediaQuery } from '@/hooks/use-media-query'
import { usePresenceStore, useUiStore } from '@/stores/ui-store'
import { conversationPeer } from '@/lib/conversations'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'

function NewChatDialog({ open, onOpenChange }) {
  const { user } = useAuth()
  const { openChat } = useWorkspace()
  const [search, setSearch] = useState('')
  const directory = useQuery({
    queryKey: queryKeys.directory({ search, page: 1, limit: 20 }),
    queryFn: () => usersApi.directory({ search, page: 1, limit: 20 }),
    enabled: open,
  })
  const start = useMutation({
    mutationFn: (userId) => conversationsApi.direct(userId),
    onSuccess: (result) => {
      onOpenChange(false)
      openChat(result.id)
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>Start a private conversation with a colleague.</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search employees"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <ScrollArea className="h-64">
          <div className="space-y-1">
            {(directory.data?.data ?? [])
              .filter((person) => person.id !== user?.id)
              .map((person) => (
                <button
                  key={person.id}
                  type="button"
                  data-testid="directory-person"
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
                  onClick={() => start.mutate(person.id)}
                >
                  <UserAvatar person={person} />
                  <span>
                    <span className="block text-sm font-medium">{person.displayName}</span>
                    <span className="text-xs text-muted-foreground">@{person.username}</span>
                  </span>
                </button>
              ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

export function ConversationSidebar() {
  const { conversationId, openChat } = useWorkspace()
  const { user } = useAuth()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const filter = useUiStore((state) => state.conversationFilter)
  const setFilter = useUiStore((state) => state.setConversationFilter)
  const query = useUiStore((state) => state.conversationQuery)
  const setQuery = useUiStore((state) => state.setConversationQuery)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const onlineMap = usePresenceStore((state) => state.online)
  const [newChat, setNewChat] = useState(false)
  const [newGroup, setNewGroup] = useState(false)

  const list = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: () => conversationsApi.list({ limit: 100 }),
  })

  const items = useMemo(
    () => filterConversations(list.data?.data, { query, filter, currentUserId: user?.id }),
    [list.data, query, filter, user?.id],
  )

  if (!isDesktop && conversationId) return null

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col border-r bg-card"
      data-testid="conversation-sidebar"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <h1 className="font-display text-xl" data-testid="chats-heading">
            Chats
          </h1>
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label="New chat" onClick={() => setNewChat(true)}>
            <Plus />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Create group" onClick={() => setNewGroup(true)}>
            <Users />
          </Button>
        </div>
      </div>
      <div className="p-3">
        <label className="sr-only" htmlFor="conversation-search">
          Search conversations
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="conversation-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="pl-9"
          />
        </div>
        <Tabs value={filter} onValueChange={setFilter} className="mt-3">
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">
              All
            </TabsTrigger>
            <TabsTrigger value="unread" className="flex-1">
              Unread
            </TabsTrigger>
            <TabsTrigger value="groups" className="flex-1">
              Groups
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {list.isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : list.isError ? (
          <EmptyState title="Could not load chats" description={getErrorMessage(list.error)} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No conversations"
            description="Start a chat or create a group to begin."
          />
        ) : (
          <ul>
            {items.map((conversation) => {
              const peer = conversationPeer(conversation, user?.id)
              const online = conversation.type === 'direct' ? Boolean(onlineMap[peer?.id]) : false
              const active = conversation.id === conversationId
              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    data-testid="conversation-item"
                    data-conversation-id={conversation.id}
                    onClick={() => openChat(conversation.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/70',
                      active && 'bg-accent',
                    )}
                  >
                    {conversation.type === 'group' ? (
                      <UserAvatar
                        variant="group"
                        userId={conversation.id}
                        name={conversationTitle(conversation, user?.id)}
                        hasPhoto={conversation.hasAvatar}
                        photoVersion={conversation.avatarVersion}
                      />
                    ) : (
                      <UserAvatar person={peer} name={conversationTitle(conversation, user?.id)} online={online} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold">
                          {conversationTitle(conversation, user?.id)}
                        </p>
                        <span className="text-[11px] text-muted-foreground">
                          {formatMessageTime(conversation.latestMessage?.createdAt || conversation.updatedAt)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-muted-foreground">
                          {previewText(conversation.latestMessage)}
                        </p>
                        {conversation.unreadCount > 0 ? (
                          <Badge
                            data-testid="unread-count"
                            className="h-5 min-w-5 justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] text-white"
                          >
                            {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
      <NewChatDialog open={newChat} onOpenChange={setNewChat} />
      <CreateGroupDialog open={newGroup} onOpenChange={setNewGroup} />
    </aside>
  )
}
