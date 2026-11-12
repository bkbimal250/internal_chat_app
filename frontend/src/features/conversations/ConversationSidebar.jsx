import { useMemo, useState } from 'react'
import { useWorkspace } from '@/hooks/use-workspace'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Menu, Plus, Search, Users } from 'lucide-react'
import { conversationsApi, usersApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { CreateGroupDialog } from '@/features/groups/CreateGroupDialog'
import { ChatContextMenu } from '@/features/conversations/ChatContextMenu'
import { ChatListItem } from '@/features/conversations/ChatListItem'
import { ChatSelectionToolbar } from '@/features/conversations/ChatSelectionToolbar'
import {
  applyHideToList,
  applyUpdatesToList,
  bulkErrorMessage,
  HIDE_CHATS_BODY,
  hideChatsTitle,
  mergeArchive,
  mergeMute,
  mergePin,
  mergeRead,
  mergeUnread,
  parseBulkResult,
  selectionSnapshot,
} from '@/lib/conversation-actions'
import { filterConversations } from '@/lib/conversations'
import { useAuth } from '@/hooks/use-auth'
import { useMediaQuery } from '@/hooks/use-media-query'
import { usePresenceStore, useUiStore } from '@/stores/ui-store'
import { conversationPeer } from '@/lib/conversations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { UserAvatar } from '@/components/common/UserAvatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  const start = useMutationSafe((userId) => conversationsApi.direct(userId), (result) => {
    onOpenChange(false)
    openChat(result.id)
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
                  onClick={() => start(person.id)}
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

function useMutationSafe(fn, onSuccess) {
  const [pending, setPending] = useState(false)
  return async (...args) => {
    if (pending) return
    setPending(true)
    try {
      const result = await fn(...args)
      onSuccess?.(result)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setPending(false)
    }
  }
}

function rowActions(snapshot, handlers) {
  const pin = snapshot.allPinned ? 'Unpin' : 'Pin'
  const mute = snapshot.allMuted ? 'Unmute' : 'Mute'
  const archive = snapshot.allArchived ? 'Unarchive' : 'Archive'
  return [
    { id: 'pin', label: pin, onSelect: handlers.onPin },
    { id: 'mute', label: mute, onSelect: handlers.onMute },
    { id: 'archive', label: archive, onSelect: handlers.onArchive },
    ...(snapshot.anyUnread ? [{ id: 'read', label: 'Mark as read', onSelect: handlers.onMarkRead }] : []),
    ...(snapshot.anyRead ? [{ id: 'unread', label: 'Mark as unread', onSelect: handlers.onMarkUnread }] : []),
    { id: 'sep', separator: true },
    { id: 'delete', label: 'Delete', destructive: true, onSelect: handlers.onDelete },
  ]
}

export function ConversationSidebar() {
  const { conversationId, openChat, closeChat } = useWorkspace()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const wideToolbar = useMediaQuery('(min-width: 480px)')
  const filter = useUiStore((state) => state.conversationFilter)
  const setFilter = useUiStore((state) => state.setConversationFilter)
  const query = useUiStore((state) => state.conversationQuery)
  const setQuery = useUiStore((state) => state.setConversationQuery)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const onlineMap = usePresenceStore((state) => state.online)
  const [newChat, setNewChat] = useState(false)
  const [newGroup, setNewGroup] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menu, setMenu] = useState(null)

  const inbox = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: () => conversationsApi.list({ limit: 100 }),
  })
  const archived = useQuery({
    queryKey: queryKeys.archivedConversations,
    queryFn: () => conversationsApi.list({ limit: 100, archived: true }),
  })

  const archivedView = filter === 'archived'
  const list = archivedView ? archived : inbox
  const items = useMemo(
    () =>
      filterConversations(list.data?.data, {
        query,
        filter: archivedView ? 'all' : filter,
        currentUserId: user?.id,
      }),
    [list.data, query, filter, archivedView, user?.id],
  )
  const selectedRows = items.filter((row) => selected.has(row.id))
  const snapshot = selectionSnapshot(selectedRows)

  if (!isDesktop && conversationId) return null

  function clearSelection() {
    setSelected(new Set())
    setMenu(null)
    setDeleteOpen(false)
  }

  function toggleId(id, event) {
    setSelected((current) => {
      const next = new Set(event?.shiftKey && current.size ? current : event?.metaKey || event?.ctrlKey || current.size ? current : [])
      if (event?.shiftKey && current.size) {
        const ids = items.map((row) => row.id)
        const last = [...current][current.size - 1]
        const from = ids.indexOf(last)
        const to = ids.indexOf(id)
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from]
          for (const rowId of ids.slice(start, end + 1)) next.add(rowId)
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function cacheLists() {
    return {
      inbox: queryClient.getQueryData(queryKeys.conversations),
      archived: queryClient.getQueryData(queryKeys.archivedConversations),
    }
  }

  function restoreLists(previous) {
    queryClient.setQueryData(queryKeys.conversations, previous.inbox)
    queryClient.setQueryData(queryKeys.archivedConversations, previous.archived)
  }

  function writeList(key, rows) {
    queryClient.setQueryData(key, (current) => ({ ...(current ?? {}), data: rows }))
  }

  async function runBulk({ request, key, apply, ids }) {
    const target = ids?.length ? ids : snapshot.ids
    if (!target.length || busy) return
    setBusy(true)
    const previous = cacheLists()
    await queryClient.cancelQueries({ queryKey: ['conversations'] })
    try {
      const body = await request(target)
      const result = parseBulkResult(body, { requested: target, key })
      apply(result, previous)
      const actionName = { hidden: 'delete', pinned: 'pin', muted: 'mute', archived: 'archive', read: 'update', unread: 'update' }[key]
      const message = bulkErrorMessage(result, actionName || 'update')
      if (message) toast.error(message)
      if (target.some((id) => id === conversationId) && key === 'hidden') {
        const hidden = new Set(result.updated.map((row) => row.id))
        if (hidden.has(conversationId)) closeChat()
      }
      clearSelection()
    } catch (error) {
      restoreLists(previous)
      toast.error(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function targetSnapshot(ids) {
    const rows = items.filter((row) => (ids ?? snapshot.ids).includes(row.id))
    return selectionSnapshot(rows)
  }

  const handlers = {
    onPin: (ids) =>
      runBulk({
        ids,
        request: (target) => conversationsApi.pinMany(target, !targetSnapshot(target).allPinned),
        key: 'pinned',
        apply: (result, previous) => {
          const inboxRows = applyUpdatesToList(
            previous.inbox?.data,
            previous.inbox?.data,
            result,
            mergePin,
            (row) => !row.archivedAt,
          )
          const archivedRows = applyUpdatesToList(
            previous.archived?.data,
            previous.archived?.data,
            result,
            mergePin,
            (row) => Boolean(row.archivedAt),
          )
          writeList(queryKeys.conversations, inboxRows)
          writeList(queryKeys.archivedConversations, archivedRows)
        },
      }),
    onMute: (ids) =>
      runBulk({
        ids,
        request: (target) => conversationsApi.muteMany(target, !targetSnapshot(target).allMuted),
        key: 'muted',
        apply: (result, previous) => {
          writeList(
            queryKeys.conversations,
            applyUpdatesToList(previous.inbox?.data, previous.inbox?.data, result, mergeMute),
          )
          writeList(
            queryKeys.archivedConversations,
            applyUpdatesToList(previous.archived?.data, previous.archived?.data, result, mergeMute),
          )
        },
      }),
    onArchive: (ids) =>
      runBulk({
        ids,
        request: (target) => conversationsApi.archiveMany(target, !targetSnapshot(target).allArchived),
        key: 'archived',
        apply: (result, previous) => {
          const inboxRows = applyUpdatesToList(
            previous.inbox?.data,
            previous.inbox?.data,
            result,
            mergeArchive,
            (row) => !row.archivedAt,
          )
          const archivedRows = applyUpdatesToList(
            previous.archived?.data,
            previous.archived?.data,
            result,
            mergeArchive,
            (row) => Boolean(row.archivedAt),
          )
          writeList(queryKeys.conversations, inboxRows)
          writeList(queryKeys.archivedConversations, archivedRows)
        },
      }),
    onMarkRead: (ids) =>
      runBulk({
        ids,
        request: (target) => conversationsApi.readMany(target),
        key: 'read',
        apply: (result, previous) => {
          writeList(
            queryKeys.conversations,
            applyUpdatesToList(previous.inbox?.data, previous.inbox?.data, result, mergeRead),
          )
          writeList(
            queryKeys.archivedConversations,
            applyUpdatesToList(previous.archived?.data, previous.archived?.data, result, mergeRead),
          )
        },
      }),
    onMarkUnread: (ids) =>
      runBulk({
        ids,
        request: (target) => conversationsApi.unreadMany(target),
        key: 'unread',
        apply: (result, previous) => {
          writeList(
            queryKeys.conversations,
            applyUpdatesToList(previous.inbox?.data, previous.inbox?.data, result, mergeUnread),
          )
          writeList(
            queryKeys.archivedConversations,
            applyUpdatesToList(previous.archived?.data, previous.archived?.data, result, mergeUnread),
          )
        },
      }),
    onDelete: (ids) => {
      if (ids?.length) setSelected(new Set(ids))
      setDeleteOpen(true)
    },
  }

  async function confirmDelete() {
    await runBulk({
      request: (ids) => conversationsApi.hideMany(ids),
      key: 'hidden',
      apply: (result, previous) => {
        writeList(queryKeys.conversations, applyHideToList(previous.inbox?.data, previous.inbox?.data, result))
        writeList(
          queryKeys.archivedConversations,
          applyHideToList(previous.archived?.data, previous.archived?.data, result),
        )
      },
    })
    setDeleteOpen(false)
  }

  function selectForMenu(conversation, event) {
    event.preventDefault()
    setSelected((current) => (current.has(conversation.id) ? current : new Set([conversation.id])))
    setMenu({ x: event.clientX, y: event.clientY, id: conversation.id })
  }

  const selecting = selected.size > 0

  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col border-r bg-card"
      data-testid="conversation-sidebar"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selecting) {
          event.preventDefault()
          clearSelection()
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && selecting && !deleteOpen) {
          event.preventDefault()
          setDeleteOpen(true)
        }
      }}
    >
      {selecting ? (
        <ChatSelectionToolbar
          snapshot={snapshot}
          compact={!wideToolbar}
          busy={busy}
          onCancel={clearSelection}
          {...handlers}
        />
      ) : (
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
      )}
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
        <Tabs
          value={filter}
          onValueChange={(value) => {
            setFilter(value)
            clearSelection()
          }}
          className="mt-3"
        >
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
            <TabsTrigger value="archived" className="flex-1" data-testid="archived-tab">
              Archived
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
            title={archivedView ? 'No archived chats' : 'No conversations'}
            description={archivedView ? 'Archived chats stay out of your main list until you unarchive them.' : 'Start a chat or create a group to begin.'}
          />
        ) : (
          <ul>
            {items.map((conversation) => (
              <ChatListItem
                key={conversation.id}
                conversation={conversation}
                currentUserId={user?.id}
                active={conversation.id === conversationId}
                selected={selected.has(conversation.id)}
                selecting={selecting}
                online={conversation.type === 'direct' ? Boolean(onlineMap[conversationPeer(conversation, user?.id)?.id]) : false}
                menuActions={rowActions(selectionSnapshot([conversation]), {
                  onPin: () => handlers.onPin([conversation.id]),
                  onMute: () => handlers.onMute([conversation.id]),
                  onArchive: () => handlers.onArchive([conversation.id]),
                  onMarkRead: () => handlers.onMarkRead([conversation.id]),
                  onMarkUnread: () => handlers.onMarkUnread([conversation.id]),
                  onDelete: () => handlers.onDelete([conversation.id]),
                })}
                onOpen={() => openChat(conversation.id)}
                onToggle={(event) => toggleId(conversation.id, event)}
                onContextMenu={(event) => selectForMenu(conversation, event)}
              />
            ))}
          </ul>
        )}
      </ScrollArea>
      <NewChatDialog open={newChat} onOpenChange={setNewChat} />
      <CreateGroupDialog open={newGroup} onOpenChange={setNewGroup} />
      {menu ? (
        <ChatContextMenu
          x={menu.x}
          y={menu.y}
          actions={rowActions(
            selectionSnapshot(items.filter((row) => (selected.has(menu.id) ? selected : new Set([menu.id])).has(row.id))),
            {
              onPin: () => handlers.onPin([...selected.has(menu.id) ? selected : [menu.id]]),
              onMute: () => handlers.onMute([...selected.has(menu.id) ? selected : [menu.id]]),
              onArchive: () => handlers.onArchive([...selected.has(menu.id) ? selected : [menu.id]]),
              onMarkRead: () => handlers.onMarkRead([...selected.has(menu.id) ? selected : [menu.id]]),
              onMarkUnread: () => handlers.onMarkUnread([...selected.has(menu.id) ? selected : [menu.id]]),
              onDelete: () => handlers.onDelete([...selected.has(menu.id) ? selected : [menu.id]]),
            },
          )}
          onClose={() => setMenu(null)}
        />
      ) : null}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{hideChatsTitle(snapshot.count || 1)}</DialogTitle>
            <DialogDescription>{HIDE_CHATS_BODY}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} data-testid="delete-cancel">
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={confirmDelete} data-testid="delete-confirm">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
