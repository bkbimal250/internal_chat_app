import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Virtuoso } from 'react-virtuoso'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CornerUpLeft,
  Forward,
  Info,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Send,
  Smile,
  Trash2,
} from 'lucide-react'
import { conversationsApi, messagesApi, receiptsApi, groupsApi, usersApi } from '@/services/api'
import { websocketManager } from '@/services/websocket'
import { queryKeys } from '@/lib/query-keys'
import {
  applySyncRecords,
  canMutateMessage,
  newestSequence,
  oldestSequence,
  receiptStatus,
  sortMessages,
  upsertMessage,
} from '@/lib/messages'
import { conversationTitle, conversationPeer } from '@/lib/conversations'
import { formatDateSeparator, formatMessageTime, sameDay } from '@/lib/time'
import { canManageGroup, memberRole } from '@/lib/permissions'
import { useAuth } from '@/hooks/use-auth'
import { usePresenceStore, useTypingStore, useUiStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { UserAvatar } from '@/components/common/UserAvatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'
import { AttachmentMedia, UploadProgress } from '@/features/messages/AttachmentViews'
import { ATTACHMENT_ACCEPT, uploadAttachment } from '@/features/messages/attachment-upload'

const EmojiPicker = lazy(() => import('emoji-picker-react'))
const EMPTY_IDS = []

function Tick({ status }) {
  const label = status === 'read' ? 'Read' : status === 'delivered' ? 'Delivered' : 'Sent'
  const Icon = status === 'read' || status === 'delivered' ? CheckCheck : Check
  return (
    <span aria-label={label} title={label} data-testid={`receipt-${status}`}>
      <Icon className={cn('size-3.5', status === 'read' && 'text-sky-600')} />
    </span>
  )
}

function MessageBubble({
  message,
  previous,
  members,
  receipts,
  currentUserId,
  isGroup,
}) {
  const mine = message.senderId === currentUserId
  const sender = members.find((member) => member.id === message.senderId)
  const showDay = !previous || !sameDay(previous.createdAt, message.createdAt)
  const replyTo = useUiStore((state) => state.setReplyTo)
  const setEditing = useUiStore((state) => state.setEditingMessage)
  const setForwarding = useUiStore((state) => state.setForwardingMessage)
  const queryClient = useQueryClient()
  const mutable = canMutateMessage(message, currentUserId)

  if (message.messageType === 'system') {
    return (
      <div className="px-4 py-2 text-center text-xs text-muted-foreground">
        {showDay ? <p className="mb-2 font-medium">{formatDateSeparator(message.createdAt)}</p> : null}
        {message.content}
      </div>
    )
  }

  return (
    <div className="px-4">
      {showDay ? (
        <p className="py-3 text-center text-xs font-medium text-muted-foreground">
          {formatDateSeparator(message.createdAt)}
        </p>
      ) : null}
      <div
        className={cn('mb-1 flex', mine ? 'justify-end' : 'justify-start')}
        data-testid="chat-message"
        data-message-id={message.id}
        data-mine={mine ? 'true' : 'false'}
      >
        <div
          className={cn(
            'max-w-[min(32rem,85%)] rounded-2xl px-3 py-2 text-sm shadow-xs',
            message.deletedAt
              ? 'bg-muted italic text-muted-foreground'
              : mine
                ? 'rounded-br-md bg-primary text-primary-foreground'
                : 'rounded-bl-md bg-secondary',
          )}
        >
          {!mine && isGroup ? (
            <p className="mb-1 text-xs font-semibold text-primary">{sender?.displayName}</p>
          ) : null}
          {message.replyToMessageId ? (
            <p className="mb-1 border-l-2 border-current/40 pl-2 text-xs opacity-80">Replying to a message</p>
          ) : null}
          {message.forwardedFromMessageId ? (
            <p className="mb-1 text-[11px] uppercase tracking-wide opacity-70">Forwarded</p>
          ) : null}
          {message.deletedAt ? (
            <p className="whitespace-pre-wrap break-words" data-testid="message-body">
              This message was deleted
            </p>
          ) : message.attachment ? (
            <AttachmentMedia attachment={message.attachment} caption={message.content} mine={mine} />
          ) : (
            <p className="whitespace-pre-wrap break-words" data-testid="message-body">
              {message.content}
            </p>
          )}
          <div className={cn('mt-1 flex items-center justify-end gap-1 text-[11px]', mine ? 'opacity-80' : 'text-muted-foreground')}>
            {message.editedAt ? <span>edited</span> : null}
            <span>{formatMessageTime(message.createdAt)}</span>
            {mine && !message.deletedAt ? (
              <Tick status={receiptStatus(message, { currentUserId, members, receipts })} />
            ) : null}
            {message.pending ? <span>sending</span> : null}
          </div>
        </div>
        {!message.deletedAt && (message.messageType === 'text' || message.attachment) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7 opacity-60" aria-label="Message actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={mine ? 'end' : 'start'}>
              <DropdownMenuItem onClick={() => replyTo(message)}>
                <CornerUpLeft /> Reply
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setForwarding(message)}>
                <Forward /> Forward
              </DropdownMenuItem>
              {mutable && message.messageType === 'text' ? (
                <DropdownMenuItem onClick={() => setEditing(message)}>
                  <Pencil /> Edit
                </DropdownMenuItem>
              ) : null}
              {mutable ? (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    try {
                      const updated = await messagesApi.remove(message.id)
                      queryClient.setQueryData(queryKeys.messages(message.conversationId), (current) => ({
                        ...current,
                        data: upsertMessage(current?.data ?? [], updated),
                      }))
                    } catch (error) {
                      toast.error(getErrorMessage(error))
                    }
                  }}
                >
                  <Trash2 /> Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  )
}

function Composer({ conversationId, apiRef }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const replyTo = useUiStore((state) => state.replyTo)
  const setReplyTo = useUiStore((state) => state.setReplyTo)
  const editing = useUiStore((state) => state.editingMessage)
  const setEditing = useUiStore((state) => state.setEditingMessage)
  const emojiOpen = useUiStore((state) => state.emojiOpen)
  const setEmojiOpen = useUiStore((state) => state.setEmojiOpen)
  const [text, setText] = useState(editing?.content ?? '')
  const [uploads, setUploads] = useState([])
  const typingRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)

  function emitTyping(start) {
    websocketManager.send({
      event: start ? 'typing.start' : 'typing.stop',
      data: { conversationId },
    })
  }

  function onChange(value) {
    setText(value)
    emitTyping(true)
    window.clearTimeout(typingRef.current)
    typingRef.current = window.setTimeout(() => emitTyping(false), 1200)
  }

  async function send() {
    const content = String(inputRef.current?.value ?? text).trim()
    if (!content) return
    if (editing) {
      try {
        const updated = await messagesApi.edit(editing.id, content)
        queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
          ...current,
          data: upsertMessage(current?.data ?? [], updated),
        }))
        setEditing(null)
        setText('')
      } catch (error) {
        toast.error(getErrorMessage(error))
      }
      return
    }

    const clientMessageId = crypto.randomUUID()
    const optimistic = {
      id: clientMessageId,
      conversationId,
      senderId: user.id,
      clientMessageId,
      content,
      messageType: 'text',
      createdAt: new Date().toISOString(),
      pending: true,
      replyToMessageId: replyTo?.id,
    }
    queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
      ...current,
      data: upsertMessage(current?.data ?? [], optimistic),
    }))
    setText('')
    setReplyTo(null)
    emitTyping(false)
    try {
      const saved = await messagesApi.create(conversationId, {
        clientMessageId,
        content,
        replyToMessageId: replyTo?.id,
      })
      queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
        ...current,
        data: upsertMessage(current?.data ?? [], saved),
      }))
    } catch (error) {
      queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
        ...current,
        data: upsertMessage(current?.data ?? [], { ...optimistic, pending: false, failed: true }),
      }))
      toast.error(getErrorMessage(error))
    }
  }

  async function startUpload(file, previousId) {
    const id = previousId ?? crypto.randomUUID()
    const controller = new AbortController()
    setUploads((current) => [
      ...current.filter((item) => item.id !== id),
      { id, file, progress: 0, error: false, controller },
    ])
    try {
      const saved = await uploadAttachment({
        conversationId,
        file,
        caption: String(inputRef.current?.value ?? text).trim(),
        replyToMessageId: replyTo?.id,
        signal: controller.signal,
        onProgress: (progress) => {
          setUploads((current) => current.map((item) => (item.id === id ? { ...item, progress } : item)))
        },
      })
      queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
        ...current,
        data: upsertMessage(current?.data ?? [], saved),
      }))
      setUploads((current) => current.filter((item) => item.id !== id))
      setText('')
      setReplyTo(null)
    } catch (error) {
      if (error.cancelled) {
        setUploads((current) => current.filter((item) => item.id !== id))
        return
      }
      setUploads((current) => current.map((item) => (item.id === id ? { ...item, error: true } : item)))
      toast.error(getErrorMessage(error))
    }
  }

  useEffect(() => {
    if (apiRef) apiRef.current = { upload: startUpload }
  })

  return (
    <div
      className="border-t bg-card p-3"
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        event.preventDefault()
        const file = event.dataTransfer.files?.[0]
        if (file) startUpload(file)
      }}
    >
      {uploads.map((item) => (
        <UploadProgress
          key={item.id}
          item={item}
          onCancel={(row) => row.controller.abort()}
          onRetry={(row) => startUpload(row.file, row.id)}
        />
      ))}
      {replyTo || editing ? (
        <div className="mb-2 flex items-center justify-between rounded-md bg-muted px-3 py-2 text-xs">
          <span>{editing ? 'Editing message' : `Replying to ${replyTo?.content?.slice(0, 80) ?? 'a message'}`}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setReplyTo(null)
              setEditing(null)
              if (editing) setText('')
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept={ATTACHMENT_ACCEPT}
          data-testid="attachment-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) startUpload(file)
          }}
        />
        <Button type="button" size="icon" variant="ghost" aria-label="Attach file" onClick={() => fileRef.current?.click()}>
          <Paperclip />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Emoji"
          onClick={() => setEmojiOpen(!emojiOpen)}
        >
          <Smile />
        </Button>
        <Textarea
          ref={inputRef}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onInput={(event) => onChange(event.target.value)}
          placeholder="Type a message"
          aria-label="Message"
          data-testid="message-composer"
          className="min-h-11 max-h-40 flex-1 resize-none"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <Button type="button" size="icon" aria-label="Send message" data-testid="send-message" onClick={send}>
          <Send />
        </Button>
      </form>
      {emojiOpen ? (
        <div className="absolute bottom-24 left-4 z-20 md:left-auto">
          <Suspense fallback={null}>
            <EmojiPicker
              onEmojiClick={(emoji) => {
                setText((value) => value + emoji.emoji)
                setEmojiOpen(false)
              }}
              width={320}
              height={360}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  )
}

function GroupPanel({ conversation, open, onOpenChange }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const role = memberRole(conversation?.members, user?.id)
  const directory = useQuery({
    queryKey: queryKeys.directory({ search, page: 1, limit: 20 }),
    queryFn: () => usersApi.directory({ search, page: 1, limit: 20 }),
    enabled: open && canManageGroup(role),
  })

  function patchMembers(updater) {
    queryClient.setQueryData(queryKeys.conversation(conversation.id), (current) => {
      if (!current?.members) return current
      return { ...current, members: updater(current.members) }
    })
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversation.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.group(conversation.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations }),
    ])
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="z-[60] w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{conversation?.title || 'Group'}</SheetTitle>
        </SheetHeader>
        <div className="h-[calc(100vh-8rem)] overflow-y-auto pr-4">
          <div className="space-y-4 p-1">
            {(conversation?.members ?? []).map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2"
                data-testid="group-member"
                data-member-role={member.role}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <UserAvatar name={member.displayName} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{member.displayName}</p>
                    <p className="text-xs capitalize text-muted-foreground">{member.role}</p>
                  </div>
                </div>
                {canManageGroup(role) && member.id !== user.id && member.role !== 'owner' ? (
                  <div className="flex flex-wrap justify-end gap-1">
                    {role === 'owner' ? (
                      <button
                        type="button"
                        data-testid={member.role === 'admin' ? 'member-demote' : 'member-promote'}
                        className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-sm shadow-xs hover:bg-accent"
                        onClick={async () => {
                          const nextRole = member.role === 'admin' ? 'member' : 'admin'
                          try {
                            await groupsApi.setRole(conversation.id, member.id, nextRole)
                            patchMembers((members) =>
                              members.map((row) => (row.id === member.id ? { ...row, role: nextRole } : row)),
                            )
                            await refresh()
                          } catch (error) {
                            toast.error(getErrorMessage(error))
                          }
                        }}
                      >
                        {member.role === 'admin' ? 'Demote' : 'Promote'}
                      </button>
                    ) : null}
                    {role === 'owner' && member.role !== 'owner' ? (
                      <button
                        type="button"
                        data-testid="member-make-owner"
                        className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-sm shadow-xs hover:bg-accent"
                        onClick={async () => {
                          try {
                            await groupsApi.transferOwner(conversation.id, member.id)
                            patchMembers((members) =>
                              members.map((row) => {
                                if (row.id === member.id) return { ...row, role: 'owner' }
                                if (row.role === 'owner') return { ...row, role: 'admin' }
                                return row
                              }),
                            )
                            await refresh()
                          } catch (error) {
                            toast.error(getErrorMessage(error))
                          }
                        }}
                      >
                        Make owner
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-testid="member-remove"
                      className="inline-flex h-8 items-center rounded-md px-3 text-sm hover:bg-muted"
                      onClick={async () => {
                        try {
                          await groupsApi.removeMember(conversation.id, member.id)
                          patchMembers((members) => members.filter((row) => row.id !== member.id))
                          await refresh()
                        } catch (error) {
                          toast.error(getErrorMessage(error))
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {canManageGroup(role) ? (
              <div>
                <p className="mb-2 text-sm font-medium">Add member</p>
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employees" />
                <div className="mt-2 space-y-1">
                  {(directory.data?.data ?? [])
                    .filter((person) => !conversation.members?.some((member) => member.id === person.id))
                    .map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        data-testid="add-member"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                        onClick={async () => {
                          try {
                            await groupsApi.addMember(conversation.id, person.id)
                            await refresh()
                          } catch (error) {
                            toast.error(getErrorMessage(error))
                          }
                        }}
                      >
                        <UserAvatar name={person.displayName} />
                        <span className="text-sm">{person.displayName}</span>
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
            {role && role !== 'owner' ? (
              <button
                type="button"
                data-testid="leave-group"
                className="inline-flex h-9 items-center rounded-md bg-destructive px-4 text-sm text-white"
                onClick={async () => {
                  try {
                    await groupsApi.leave(conversation.id)
                    onOpenChange(false)
                    navigate('/')
                  } catch (error) {
                    toast.error(getErrorMessage(error))
                  }
                }}
              >
                Leave group
              </button>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function MessagePane({ conversationId }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const groupPanelOpen = useUiStore((state) => state.groupPanelOpen)
  const setGroupPanelOpen = useUiStore((state) => state.setGroupPanelOpen)
  const forwarding = useUiStore((state) => state.forwardingMessage)
  const setForwarding = useUiStore((state) => state.setForwardingMessage)
  const editing = useUiStore((state) => state.editingMessage)
  const typingIds = useTypingStore((state) => state.byConversation[conversationId] || EMPTY_IDS)
  const onlineMap = usePresenceStore((state) => state.online)
  const composerApi = useRef(null)
  const [dropping, setDropping] = useState(false)

  const details = useQuery({
    queryKey: queryKeys.conversation(conversationId),
    queryFn: () => conversationsApi.details(conversationId),
  })
  const receipts = useQuery({
    queryKey: queryKeys.receipts(conversationId),
    queryFn: () => receiptsApi.conversation(conversationId),
  })
  const messagesQuery = useQuery({
    queryKey: queryKeys.messages(conversationId),
    queryFn: async () => {
      const conversation = await conversationsApi.details(conversationId)
      const last = conversation.lastMessageSeq ?? 0
      const afterSeq = Math.max(0, last - 80)
      const page = await messagesApi.list(conversationId, { afterSeq, limit: 80 })
      const synced = await messagesApi.sync(conversationId, {
        afterChangeSeq: Math.max(0, (conversation.lastChangeSeq ?? 0) - 80),
        limit: 80,
      })
      return { data: applySyncRecords(page.data ?? [], synced.data ?? []) }
    },
  })

  const messages = useMemo(
    () => sortMessages(messagesQuery.data?.data ?? []),
    [messagesQuery.data],
  )
  const deliveredRef = useRef(new Set())
  const lastReadRef = useRef(0)

  useEffect(() => {
    deliveredRef.current = new Set()
    lastReadRef.current = 0
  }, [conversationId])

  useEffect(() => {
    const incoming = messages.filter(
      (message) =>
        message.senderId &&
        message.senderId !== user?.id &&
        !message.deletedAt &&
        !message.pending &&
        !deliveredRef.current.has(message.id),
    )
    incoming.forEach((message) => {
      deliveredRef.current.add(message.id)
      websocketManager.send({ event: 'message.delivered', data: { messageId: message.id } })
    })
    const newest = newestSequence(messages)
    if (newest > lastReadRef.current) {
      lastReadRef.current = newest
      conversationsApi.read(conversationId, newest).catch(() => {})
      websocketManager.send({
        event: 'conversation.read',
        data: { conversationId, sequenceNumber: newest },
      })
      queryClient.setQueryData(queryKeys.conversations, (current) => {
        if (!current?.data) return current
        if (current.data.every((row) => row.id !== conversationId || row.unreadCount === 0)) return current
        return {
          ...current,
          data: current.data.map((row) => (row.id === conversationId ? { ...row, unreadCount: 0 } : row)),
        }
      })
    }
  }, [conversationId, messages, queryClient, user?.id])

  const conversationList = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: () => conversationsApi.list({ limit: 50 }),
  })

  const title = conversationTitle(details.data, user?.id)
  const peer = conversationPeer(details.data, user?.id)
  const typingNames = typingIds
    .filter((id) => id !== user?.id)
    .map((id) => details.data?.members?.find((member) => member.id === id)?.displayName)
    .filter(Boolean)

  if (messagesQuery.isLoading || details.isLoading) {
    return (
      <section className="flex h-full flex-1 flex-col">
        <Skeleton className="h-16" />
        <div className="flex-1 p-4">
          <Skeleton className="h-20" />
        </div>
      </section>
    )
  }

  if (details.isError) {
    return <EmptyState title="Conversation unavailable" description={getErrorMessage(details.error)} />
  }

  return (
    <section
      className="relative flex h-full min-w-0 flex-1 flex-col bg-[linear-gradient(180deg,oklch(0.98_0.01_92),oklch(0.96_0.012_90))]"
      data-testid="message-pane"
      onDragOver={(event) => {
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDropping(false)
        const file = event.dataTransfer.files?.[0]
        if (file) composerApi.current?.upload(file)
      }}
    >
      <header className="flex h-16 items-center justify-between gap-3 border-b bg-card/90 px-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="md:hidden" asChild aria-label="Back to chats">
            <Link to="/">
              <ArrowLeft />
            </Link>
          </Button>
          <UserAvatar name={title} online={Boolean(onlineMap[peer?.id])} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{title}</p>
            <p className="truncate text-xs text-muted-foreground" data-testid="chat-subtitle">
              {typingNames.length
                ? `${typingNames.join(', ')} typing…`
                : details.data?.type === 'group'
                  ? `${details.data.members?.length ?? 0} members`
                  : onlineMap[peer?.id]
                    ? 'Online'
                    : 'Offline'}
            </p>
          </div>
        </div>
        {details.data?.type === 'group' ? (
          <Button variant="ghost" size="icon" aria-label="Group info" onClick={() => setGroupPanelOpen(true)}>
            <Info />
          </Button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">
        {messages.length === 0 ? (
          <EmptyState title="No messages yet" description="Say hello to start this conversation." />
        ) : (
          <Virtuoso
            data={messages}
            followOutput="smooth"
            startReached={async () => {
              const oldest = oldestSequence(messages)
              if (!oldest || oldest <= 1) return
              const page = await messagesApi.list(conversationId, {
                afterSeq: Math.max(0, oldest - 51),
                limit: 50,
              })
              queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
                ...current,
                data: (page.data ?? []).reduce((list, message) => upsertMessage(list, message), current?.data ?? []),
              }))
            }}
            itemContent={(index, message) => (
              <MessageBubble
                message={message}
                previous={messages[index - 1]}
                members={details.data?.members ?? []}
                receipts={receipts.data ?? []}
                currentUserId={user.id}
                isGroup={details.data?.type === 'group'}
              />
            )}
          />
        )}
      </div>
      {dropping ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/10 text-sm font-medium">
          Drop file to send
        </div>
      ) : null}
      <Composer
        key={editing?.id ?? `compose-${conversationId}`}
        conversationId={conversationId}
        apiRef={composerApi}
      />
      <GroupPanel
        conversation={details.data}
        open={groupPanelOpen && details.data?.type === 'group'}
        onOpenChange={setGroupPanelOpen}
      />
      <Dialog open={Boolean(forwarding)} onOpenChange={(open) => !open && setForwarding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Forward message</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-64">
            {(conversationList.data?.data ?? [])
              .filter((row) => row.id !== conversationId)
              .map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                  onClick={async () => {
                    try {
                      await messagesApi.forward(forwarding.id, {
                        conversationId: row.id,
                        clientMessageId: crypto.randomUUID(),
                        content: forwarding.content,
                      })
                      setForwarding(null)
                      toast.success('Message forwarded')
                    } catch (error) {
                      toast.error(getErrorMessage(error))
                    }
                  }}
                >
                  {conversationTitle(row, user.id)}
                </button>
              ))}
          </ScrollArea>
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </section>
  )
}
