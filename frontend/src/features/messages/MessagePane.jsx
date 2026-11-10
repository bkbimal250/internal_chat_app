import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { useWorkspace } from '@/hooks/use-workspace'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  Forward,
  Info,
  LogOut,
  MoreVertical,
  Mic,
  Phone,
  Search,
  Send,
  Smile,
  UserPlus,
  X,
} from 'lucide-react'
import { conversationsApi, messagesApi, receiptsApi, groupsApi, retentionApi } from '@/services/api'
import { touchConversationFromMessage } from '@/lib/realtime-events'
import { websocketManager } from '@/services/websocket'
import { queryKeys } from '@/lib/query-keys'
import {
  applySyncRecords,
  newestSequence,
  oldestSequence,
  receiptStatus,
  sortMessages,
  upsertMessage,
} from '@/lib/messages'
import { conversationTitle, conversationPeer, previewText } from '@/lib/conversations'
import { remoteTypingNames, typingLabel } from '@/lib/typing-label'
import { MessageActions, ReactionChips } from '@/features/messages/MessageActions'
import { formatDateSeparator, formatMessageTime, sameDay } from '@/lib/time'
import { canAddGroupMembers, canSendGroupMessages, groupSettings, memberRole } from '@/lib/permissions'
import { useAuth } from '@/hooks/use-auth'
import { useFeaturesStore } from '@/stores/features-store'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { AttachmentDraftTray } from '@/features/messages/AttachmentDraftTray'
import {
  addSelectedFiles,
  messageAttachments,
  readMediaDuration,
  revokePreview,
  revokePreviews,
} from '@/features/messages/attachment-batch'
import {
  ATTACHMENT_ACCEPT,
  completeAttachmentBatch,
  FILE_UPLOAD_CONCURRENCY,
  uploadAttachment,
  uploadToStorage,
} from '@/features/messages/attachment-upload'
import { clearTransfer, loadTransfers, runPool, saveTransfers } from '@/features/messages/transfer-runtime'
import { attachmentsApi } from '@/services/api'
import { AttachMenu } from '@/features/messages/AttachMenu'
import { startVoiceRecording } from '@/features/messages/voice-record'
import { useCallStore } from '@/features/calls/call-store'
import { ChatInfoPanel } from '@/features/groups/ChatInfoPanel'
import { RetentionBanner, retentionCopy } from '@/features/retention/RetentionBanner'
import { visibleMessages } from '@/lib/messages'

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
  conversationType,
  highlight = false,
}) {
  const mine = message.senderId === currentUserId
  const sender = members.find((member) => member.id === message.senderId)
  const showDay = !previous || !sameDay(previous.createdAt, message.createdAt)
  const quoted = message.replyTo

  if (message.messageType === 'system') {
    return (
      <div className="px-4 py-2 text-center text-xs text-muted-foreground">
        {showDay ? <p className="mb-2 font-medium">{formatDateSeparator(message.createdAt)}</p> : null}
        {message.content}
      </div>
    )
  }

  return (
    <div className="px-3 md:px-8">
      {showDay ? (
        <p className="py-3 text-center text-[11px] font-medium text-muted-foreground">
          <span className="rounded-full bg-card/90 px-3 py-1 shadow-xs">{formatDateSeparator(message.createdAt)}</span>
        </p>
      ) : null}
      <div
        className={cn('group mb-0.5 flex items-start gap-1', mine ? 'justify-end' : 'justify-start')}
        data-testid="chat-message"
        data-message-id={message.id}
        data-mine={mine ? 'true' : 'false'}
      >
        {!mine && isGroup ? (
          <UserAvatar person={sender} className="mt-1 size-7" fallbackClassName="text-[10px]" />
        ) : null}
        {mine ? (
          <MessageActions
            message={message}
            currentUserId={currentUserId}
            isGroup={isGroup}
            conversationType={conversationType}
            align="end"
          />
        ) : null}
        <div className={cn('flex min-w-0 max-w-[min(32rem,85%)] flex-col', mine ? 'items-end' : 'items-start')}>
          <div
            className={cn(
              'w-full rounded-lg px-2.5 py-1.5 text-sm shadow-xs',
              highlight && 'ring-2 ring-primary/50',
              message.deletedAt
                ? 'bg-muted italic text-muted-foreground'
                : mine
                  ? 'rounded-tr-none bg-primary text-primary-foreground'
                  : 'rounded-tl-none bg-card',
            )}
          >
            {!mine && isGroup ? (
              <p className="mb-0.5 text-xs font-semibold text-emerald-700">{sender?.displayName}</p>
            ) : null}
            {quoted || message.replyToMessageId ? (
              <div
                className="mb-1 rounded-sm border-l-2 border-current/40 bg-black/5 px-2 py-1 text-xs opacity-80"
                data-testid="message-quote"
              >
                <p className="font-semibold">{quoted?.senderName || 'Message'}</p>
                <p className="truncate">{quoted ? previewText(quoted) : 'Replying to a message'}</p>
              </div>
            ) : null}
            {message.forwardedFromMessageId ? (
              <p className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide opacity-70">
                <Forward className="size-3" /> Forwarded
              </p>
            ) : null}
            {message.deletedAt ? (
              <p className="whitespace-pre-wrap break-words" data-testid="message-body">
                This message was deleted
              </p>
            ) : messageAttachments(message).length ? (
              <AttachmentMedia
                attachment={message.attachment}
                attachments={messageAttachments(message)}
                caption={message.content}
                conversationId={message.conversationId}
                mine={mine}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words" data-testid="message-body">
                {message.content}
              </p>
            )}
            <div className={cn('mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-none', mine ? 'opacity-80' : 'text-muted-foreground')}>
              {message.editedAt ? <span>edited</span> : null}
              <span>{formatMessageTime(message.createdAt)}</span>
              {message.expiresAt ? (
                <span title={`Expires ${formatDateSeparator(message.expiresAt)}`} data-testid="message-expiry">
                  · expires {formatMessageTime(message.expiresAt)}
                </span>
              ) : null}
              {mine && !message.deletedAt ? (
                <Tick status={receiptStatus(message, { currentUserId, members, receipts })} />
              ) : null}
              {message.pending ? <span>sending</span> : null}
            </div>
          </div>
          <ReactionChips message={message} currentUserId={currentUserId} mine={mine} />
        </div>
        {!mine ? (
          <MessageActions
            message={message}
            currentUserId={currentUserId}
            isGroup={isGroup}
            conversationType={conversationType}
            align="start"
          />
        ) : null}
      </div>
    </div>
  )
}

function Composer({ conversationId, apiRef, canSend = true }) {
  const { user } = useAuth()
  const attachmentsEnabled = useFeaturesStore((state) => state.attachmentsEnabled)
  const queryClient = useQueryClient()
  const replyTo = useUiStore((state) => state.replyTo)
  const setReplyTo = useUiStore((state) => state.setReplyTo)
  const editing = useUiStore((state) => state.editingMessage)
  const setEditing = useUiStore((state) => state.setEditingMessage)
  const emojiOpen = useUiStore((state) => state.emojiOpen)
  const setEmojiOpen = useUiStore((state) => state.setEmojiOpen)
  const [text, setText] = useState(editing?.content ?? '')
  const [uploads, setUploads] = useState([])
  const [drafts, setDrafts] = useState([])
  const [sendingDrafts, setSendingDrafts] = useState(false)
  const [mediaQuality, setMediaQuality] = useState('auto')
  const typingRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const voiceRef = useRef(null)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const resumePickerRef = useRef(null)

  useEffect(() => {
    setUploads(
      loadTransfers(conversationId).map((row) => ({
        ...row,
        controller: new AbortController(),
      })),
    )
  }, [conversationId])

  useEffect(() => {
    saveTransfers(conversationId, uploads)
  }, [conversationId, uploads])

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
    if (drafts.length) {
      await sendDrafts()
      return
    }
    emitTyping(false)
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
    const quoted = replyTo
    const optimistic = {
      id: clientMessageId,
      conversationId,
      senderId: user.id,
      clientMessageId,
      content,
      messageType: 'text',
      createdAt: new Date().toISOString(),
      pending: true,
      replyToMessageId: quoted?.id,
      replyTo: quoted
        ? {
            id: quoted.id,
            senderId: quoted.senderId,
            senderName: quoted.senderName,
            content: quoted.content,
            messageType: quoted.messageType,
            deletedAt: quoted.deletedAt,
          }
        : null,
    }
    queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
      ...current,
      data: upsertMessage(current?.data ?? [], optimistic),
    }))
    touchConversationFromMessage(conversationId, optimistic)
    setText('')
    setReplyTo(null)
    emitTyping(false)
    try {
      const saved = await messagesApi.create(conversationId, {
        clientMessageId,
        content,
        replyToMessageId: quoted?.id,
      })
      queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
        ...current,
        data: upsertMessage(current?.data ?? [], saved),
      }))
      touchConversationFromMessage(conversationId, saved)
    } catch (error) {
      queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
        ...current,
        data: upsertMessage(current?.data ?? [], { ...optimistic, pending: false, failed: true }),
      }))
      toast.error(getErrorMessage(error))
    }
  }

  async function startUpload(file, previous) {
    if (!canSend || !attachmentsEnabled) return
    const resume = typeof previous === 'object' && previous ? previous : uploads.find((item) => item.id === previous)
    if (!file) {
      resumePickerRef.current = resume
      fileRef.current?.click()
      toast.error('Reselect the original file to resume this upload.')
      return
    }
    const id = resume?.id ?? crypto.randomUUID()
    const clientMessageId = resume?.clientMessageId ?? crypto.randomUUID()
    const controller = new AbortController()
    setUploads((current) => [
      ...current.filter((item) => item.id !== id),
      {
        ...resume,
        id,
        file,
        clientMessageId,
        progress: resume?.progress ?? 0,
        error: false,
        needsFile: false,
        controller,
      },
    ])
    try {
      const saved = await uploadAttachment({
        conversationId,
        file,
        caption: String(inputRef.current?.value ?? text).trim(),
        replyToMessageId: replyTo?.id,
        quality: mediaQuality,
        signal: controller.signal,
        clientMessageId,
        attachmentId: resume?.attachmentId,
        completedParts: resume?.parts ?? [],
        onState: (state) => {
          setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...state } : item)))
        },
        onProgress: (progress) => {
          const next = typeof progress === 'number' ? { percent: progress } : progress
          setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...next, progress: next.percent ?? 0 } : item)))
        },
      })
      queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
        ...current,
        data: upsertMessage(current?.data ?? [], saved),
      }))
      touchConversationFromMessage(conversationId, saved)
      setUploads((current) => current.filter((item) => item.id !== id))
      clearTransfer(conversationId, id)
      setText('')
      setReplyTo(null)
    } catch (error) {
      if (error.cancelled) {
        setUploads((current) => current.filter((item) => item.id !== id))
        clearTransfer(conversationId, id)
        return
      }
      setUploads((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                error: true,
                attachmentId: error.attachmentId ?? item.attachmentId,
                clientMessageId: error.clientMessageId ?? item.clientMessageId,
                parts: error.parts ?? item.parts,
              }
            : item,
        ),
      )
      toast.error(getErrorMessage(error))
    }
  }

  function queueFiles(incoming) {
    if (!canSend || !attachmentsEnabled) return
    const files = Array.isArray(incoming) ? incoming : incoming ? [incoming] : []
    if (!files.length) return
    const { items, errors } = addSelectedFiles(drafts, files)
    errors.forEach((error) => toast.error(error.message))
    setDrafts(items)
    items
      .filter((item) => !item.duration && (item.kind === 'video' || item.kind === 'audio'))
      .forEach((item) => {
        readMediaDuration(item.file).then((duration) => {
          if (!duration) return
          setDrafts((current) => current.map((row) => (row.id === item.id ? { ...row, duration } : row)))
        })
      })
  }

  async function removeDraft(item) {
    revokePreview(item)
    item.controller?.abort()
    if (item.attachmentId) await attachmentsApi.remove(item.attachmentId).catch(() => {})
    setDrafts((current) => current.filter((row) => row.id !== item.id))
  }

  function clearDrafts() {
    for (const item of drafts) {
      revokePreview(item)
      item.controller?.abort()
      if (item.attachmentId) attachmentsApi.remove(item.attachmentId).catch(() => {})
    }
    setDrafts([])
  }

  async function uploadDraft(item) {
    if (!item.file) {
      toast.error('Reselect the original file to resume this upload.')
      fileRef.current?.click()
      return item
    }
    const controller = new AbortController()
    setDrafts((current) =>
      current.map((row) =>
        row.id === item.id ? { ...row, status: 'uploading', error: false, progress: row.progress || 0, controller } : row,
      ),
    )
    try {
      const stored = await uploadToStorage({
        conversationId,
        file: item.file,
        quality: mediaQuality,
        signal: controller.signal,
        attachmentId: item.attachmentId,
        completedParts: item.parts ?? [],
        abortOnCancel: true,
        onState: (state) => {
          setDrafts((current) => current.map((row) => (row.id === item.id ? { ...row, ...state } : row)))
        },
        onProgress: (progress) => {
          const next = typeof progress === 'number' ? { percent: progress } : progress
          setDrafts((current) =>
            current.map((row) => (row.id === item.id ? { ...row, ...next, progress: next.percent ?? 0, status: 'uploading' } : row)),
          )
        },
      })
      const uploaded = {
        ...item,
        status: 'uploaded',
        progress: 100,
        attachmentId: stored.init.id,
        parts: stored.parts,
        controller,
      }
      setDrafts((current) => current.map((row) => (row.id === item.id ? uploaded : row)))
      return uploaded
    } catch (error) {
      if (error.cancelled) {
        setDrafts((current) => current.filter((row) => row.id !== item.id))
        return null
      }
      setDrafts((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, status: 'failed', error: true, attachmentId: error.attachmentId ?? row.attachmentId, parts: error.parts ?? row.parts }
            : row,
        ),
      )
      toast.error(getErrorMessage(error))
      return { ...item, status: 'failed', error: true }
    }
  }

  async function sendDrafts() {
    if (!drafts.length || sendingDrafts) return
    emitTyping(false)
    setSendingDrafts(true)
    const caption = String(inputRef.current?.value ?? text).trim()
    const clientMessageId = crypto.randomUUID()
    const replyToMessageId = replyTo?.id
    try {
      const pending = drafts.filter((item) => item.status !== 'uploaded' || !item.attachmentId)
      const already = drafts.filter((item) => item.status === 'uploaded' && item.attachmentId)
      const uploaded = (await runPool(pending, FILE_UPLOAD_CONCURRENCY, uploadDraft)).filter(Boolean)
      const ready = [...already, ...uploaded.filter((item) => item.status === 'uploaded' && item.attachmentId)]
      if (ready.length !== drafts.length) {
        toast.error('Some files failed to upload. Retry or remove them, then send.')
        return
      }
      const saved = await completeAttachmentBatch({
        conversationId,
        clientMessageId,
        caption,
        replyToMessageId,
        items: ready.map((item) => ({
          id: item.attachmentId,
          ...(item.parts?.length ? { parts: item.parts } : {}),
        })),
      })
      queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
        ...current,
        data: upsertMessage(current?.data ?? [], saved),
      }))
      touchConversationFromMessage(conversationId, saved)
      revokePreviews(drafts)
      setDrafts([])
      setText('')
      setReplyTo(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSendingDrafts(false)
    }
  }

  useEffect(() => {
    if (apiRef) apiRef.current = { upload: queueFiles }
  })

  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  useEffect(() => {
    const stopTyping = () =>
      websocketManager.send({
        event: 'typing.stop',
        data: { conversationId },
      })
    stopTyping()
    return () => {
      stopTyping()
      revokePreviews(draftsRef.current)
      useTypingStore.getState().clearConversation(conversationId)
    }
  }, [conversationId])

  useEffect(() => () => voiceRef.current?.cancel(), [])

  useEffect(() => {
    if (!recording) return undefined
    const timer = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording])

  async function toggleVoice() {
    if (!attachmentsEnabled) return
    if (recording) {
      const session = voiceRef.current
      voiceRef.current = null
      setRecording(false)
      setRecordSeconds(0)
      try {
        const file = await session?.stop()
        if (file) await startUpload(file)
      } catch (error) {
        toast.error(getErrorMessage(error))
      }
      return
    }
    try {
      voiceRef.current = await startVoiceRecording()
      setRecordSeconds(0)
      setRecording(true)
    } catch (error) {
      toast.error(getErrorMessage(error) || 'Microphone access is required to send audio')
    }
  }

  function cancelVoice() {
    voiceRef.current?.cancel()
    voiceRef.current = null
    setRecording(false)
    setRecordSeconds(0)
  }

  return (
    <div
      className="bg-muted/50 px-3 py-2"
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        event.preventDefault()
        if (!canSend) return
        queueFiles(Array.from(event.dataTransfer.files || []))
      }}
    >
      {uploads.map((item) => (
        <UploadProgress
          key={item.id}
          item={item}
          onCancel={(row) => row.controller.abort()}
          onRetry={(row) => startUpload(row.file, row)}
        />
      ))}
      <AttachmentDraftTray
        items={drafts}
        sending={sendingDrafts}
        onRemove={removeDraft}
        onRetry={(item) => uploadDraft(item)}
        onCancel={(item) => item.controller?.abort()}
        onAddMore={() => fileRef.current?.click()}
        onClear={clearDrafts}
      />
      {!canSend ? (
        <div className="border-t bg-card px-4 py-3 text-center text-sm text-muted-foreground" data-testid="admins-only-composer">
          Only group admins can send messages.
        </div>
      ) : null}
      {canSend && (replyTo || editing) ? (
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
      {canSend ? (
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {attachmentsEnabled ? (
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept={ATTACHMENT_ACCEPT}
          multiple
          data-testid="attachment-input"
          onChange={(event) => {
            const files = Array.from(event.target.files || [])
            event.target.value = ''
            const resume = resumePickerRef.current
            resumePickerRef.current = null
            if (resume && files[0]) {
              startUpload(files[0], resume)
              if (files.length > 1) queueFiles(files.slice(1))
              return
            }
            queueFiles(files)
          }}
        />
        ) : null}
        {recording ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[28px] border bg-card px-3 py-2 shadow-xs">
            <span className="size-2.5 animate-pulse rounded-full bg-destructive" />
            <span className="text-sm font-medium">
              {`${String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:${String(recordSeconds % 60).padStart(2, '0')}`}
            </span>
            <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={cancelVoice}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-end rounded-[28px] border bg-card px-1.5 py-1 shadow-xs">
            {attachmentsEnabled ? <AttachMenu disabled={!canSend || sendingDrafts} onPick={queueFiles} /> : null}
            {attachmentsEnabled ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-full"
              aria-label="Record audio"
              data-testid="record-audio"
              onClick={toggleVoice}
            >
              <Mic />
            </Button>
            ) : null}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-full"
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
              className="min-h-9 max-h-40 flex-1 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0"
              onPaste={(event) => {
                const files = Array.from(event.clipboardData?.files || [])
                if (!files.length) return
                event.preventDefault()
                queueFiles(files)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
            />
            <select
              aria-label="Media quality"
              className="mr-1 hidden max-w-24 bg-transparent text-[11px] text-muted-foreground sm:block"
              value={mediaQuality}
              onChange={(event) => setMediaQuality(event.target.value)}
            >
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="data-saver">Saver</option>
              <option value="original">Original</option>
            </select>
          </div>
        )}
        <Button
          type="button"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          aria-label={recording ? 'Send audio' : 'Send message'}
          data-testid="send-message"
          onClick={recording ? toggleVoice : send}
        >
          <Send />
        </Button>
      </form>
      ) : null}
      {canSend && emojiOpen ? (
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

const BOTTOM_THRESHOLD = 80

function scrollerAtBottom(node) {
  if (!node) return true
  return node.scrollHeight - node.scrollTop - node.clientHeight <= BOTTOM_THRESHOLD
}

function MessageThread({
  conversationId,
  messages,
  members,
  receipts,
  lastMessageSeq = 0,
  retentionDays = 90,
  currentUserId,
  isGroup,
  conversationType,
  unreadCount = 0,
  searchQuery = '',
}) {
  const queryClient = useQueryClient()
  const scrollerRef = useRef(null)
  const atBottomRef = useRef(true)
  const readyRef = useRef(false)
  const loadingOlderRef = useRef(false)
  const restoreRef = useRef(null)
  const primedRef = useRef(false)
  const newestSeenRef = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const [newWhileAway, setNewWhileAway] = useState(0)
  const deliveredRef = useRef(new Set())
  const lastReadRef = useRef(0)

  function markAtBottom(isAtBottom) {
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    if (isAtBottom) setNewWhileAway(0)
  }

  function scrollToLatest(behavior = 'smooth') {
    const node = scrollerRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior })
    markAtBottom(true)
  }

  const hasMessages = messages.length > 0

  useLayoutEffect(() => {
    const node = scrollerRef.current
    if (!node || !hasMessages) return

    const restore = restoreRef.current
    if (restore) {
      node.scrollTop = restore.top + (node.scrollHeight - restore.height)
      restoreRef.current = null
      markAtBottom(scrollerAtBottom(node))
      return
    }

    const last = messages[messages.length - 1]
    const stick =
      !readyRef.current ||
      atBottomRef.current ||
      last?.senderId === currentUserId ||
      last?.pending
    if (stick) {
      node.scrollTop = node.scrollHeight
      markAtBottom(true)
    }
    readyRef.current = true
  }, [conversationId, currentUserId, hasMessages, messages])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node || !hasMessages) return undefined
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) node.scrollTop = node.scrollHeight
    })
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    return () => observer.disconnect()
  }, [hasMessages])

  useEffect(() => {
    const incoming = messages.filter(
      (message) =>
        message.senderId &&
        message.senderId !== currentUserId &&
        !message.deletedAt &&
        !message.pending &&
        !deliveredRef.current.has(message.id),
    )
    incoming.forEach((message) => {
      deliveredRef.current.add(message.id)
      websocketManager.send({ event: 'message.delivered', data: { messageId: message.id } })
    })

    const newest = newestSequence(messages)
    if (!primedRef.current) {
      primedRef.current = true
      newestSeenRef.current = newest
    } else if (newest > newestSeenRef.current) {
      const fresh = messages.filter(
        (message) =>
          Number(message.sequenceNumber ?? 0) > newestSeenRef.current &&
          message.senderId &&
          message.senderId !== currentUserId &&
          !message.pending,
      )
      if (!atBottomRef.current && fresh.length) {
        setNewWhileAway((count) => count + fresh.length)
      }
      newestSeenRef.current = newest
    }

    if (!atBottomRef.current) return
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
  }, [atBottom, conversationId, currentUserId, messages, queryClient])

  async function loadOlder() {
    if (!readyRef.current || loadingOlderRef.current) return
    const oldest = oldestSequence(messages)
    if (!oldest || oldest <= 1) return
    loadingOlderRef.current = true
    const node = scrollerRef.current
    if (node) restoreRef.current = { height: node.scrollHeight, top: node.scrollTop }
    try {
      const page = await messagesApi.list(conversationId, {
        afterSeq: Math.max(0, oldest - 51),
        limit: 50,
      })
      const incoming = page.data ?? []
      queryClient.setQueryData(queryKeys.messages(conversationId), (current) => ({
        ...current,
        data: incoming.reduce((list, message) => upsertMessage(list, message), current?.data ?? []),
      }))
    } finally {
      loadingOlderRef.current = false
    }
  }

  function onScroll(event) {
    const node = event.currentTarget
    const isBottom = scrollerAtBottom(node)
    markAtBottom(isBottom)
    if (readyRef.current && node.scrollTop < BOTTOM_THRESHOLD) void loadOlder()
  }

  if (messages.length === 0) {
    return lastMessageSeq > 0 ? (
      <EmptyState title="Older messages were removed" description={retentionCopy(retentionDays)} />
    ) : (
      <EmptyState title="No messages yet" description="Say hello to start this conversation." />
    )
  }

  const unseenCount = newWhileAway > 0 ? newWhileAway : atBottom ? 0 : unreadCount

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scrollerRef}
        className="h-full min-h-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
        data-testid="message-scroller"
        onScroll={onScroll}
      >
        <div className="flex min-h-full flex-col justify-end">
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              previous={messages[index - 1]}
              members={members}
              receipts={receipts}
              currentUserId={currentUserId}
              isGroup={isGroup}
              conversationType={conversationType}
              highlight={Boolean(
                searchQuery &&
                  String(message.content || '')
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
              )}
            />
          ))}
          <div className="h-4 shrink-0" aria-hidden="true" />
        </div>
      </div>
      {!atBottom ? (
        <Button
          type="button"
          size="sm"
          className="absolute right-4 bottom-4 z-20 gap-1 rounded-full shadow-md"
          data-testid="jump-to-latest"
          aria-label={unseenCount > 0 ? `${unseenCount} new messages` : 'Jump to latest messages'}
          onClick={() => scrollToLatest('smooth')}
        >
          <ArrowDown className="size-4" />
          {unseenCount > 0 ? (
            <span data-testid="new-message-count">{unseenCount > 99 ? '99+' : unseenCount}</span>
          ) : null}
        </Button>
      ) : null}
    </div>
  )
}

export function MessagePane({ conversationId }) {
  const { user } = useAuth()
  const { closeChat } = useWorkspace()
  const callsEnabled = useFeaturesStore((state) => state.callsEnabled)
  const groupPanelOpen = useUiStore((state) => state.groupPanelOpen)
  const setGroupPanelOpen = useUiStore((state) => state.setGroupPanelOpen)
  const setAddMembersOpen = useUiStore((state) => state.setAddMembersOpen)
  const forwarding = useUiStore((state) => state.forwardingMessage)
  const setForwarding = useUiStore((state) => state.setForwardingMessage)
  const replyTo = useUiStore((state) => state.replyTo)
  const setReplyTo = useUiStore((state) => state.setReplyTo)
  const editing = useUiStore((state) => state.editingMessage)
  const typingIds = useTypingStore((state) => state.byConversation[conversationId] || EMPTY_IDS)
  const onlineMap = usePresenceStore((state) => state.online)
  const composerApi = useRef(null)
  const [dropping, setDropping] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [messageQuery, setMessageQuery] = useState('')

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
    () => sortMessages(visibleMessages(messagesQuery.data?.data ?? [])),
    [messagesQuery.data],
  )
  const retention = useQuery({
    queryKey: queryKeys.conversationRetention(conversationId),
    queryFn: () => retentionApi.conversation(conversationId),
  })

  const conversationList = useQuery({
    queryKey: queryKeys.conversations,
    queryFn: () => conversationsApi.list({ limit: 100 }),
  })

  useEffect(() => {
    if (!replyTo || !details.data) return
    if (replyTo.conversationId === conversationId) return
    const peerId = conversationPeer(details.data, user?.id)?.id
    if (details.data.type === 'direct' && peerId === replyTo.senderId) return
    setReplyTo(null)
  }, [conversationId, details.data, replyTo, setReplyTo, user?.id])

  const title = conversationTitle(details.data, user?.id)
  const peer = conversationPeer(details.data, user?.id)
  const isGroup = details.data?.type === 'group'
  const role = memberRole(details.data?.members, user?.id)
  const canSend = !isGroup || canSendGroupMessages(role, groupSettings(details.data))
  const typingNames = remoteTypingNames(typingIds, details.data?.members, user?.id)
  const typingCopy = typingLabel(typingNames)

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
      className="chat-wallpaper relative flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="message-pane"
      onDragOver={(event) => {
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDropping(false)
        const files = Array.from(event.dataTransfer.files || [])
        if (files.length && canSend) composerApi.current?.upload(files)
      }}
    >
      <header className="flex h-16 items-center justify-between gap-2 border-b bg-card px-2 shadow-xs md:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Back to chats" onClick={() => closeChat()}>
            <ArrowLeft />
          </Button>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-muted/70"
            aria-label={isGroup ? 'Group info' : 'Contact info'}
            onClick={() => setGroupPanelOpen(true)}
          >
            {isGroup ? (
              <UserAvatar
                variant="group"
                userId={conversationId}
                name={title}
                hasPhoto={details.data?.hasAvatar}
                photoVersion={details.data?.avatarVersion}
              />
            ) : (
              <UserAvatar person={peer} name={title} online={Boolean(onlineMap[peer?.id])} />
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold">{title}</p>
              <p className="truncate text-xs text-muted-foreground" data-testid="chat-subtitle">
                {typingCopy
                  ? typingCopy
                  : isGroup
                    ? `${details.data.members?.length ?? 0} members`
                    : onlineMap[peer?.id]
                      ? 'Online'
                      : 'Offline'}
              </p>
            </div>
          </button>
        </div>
        <div className="flex items-center">
          {!isGroup && callsEnabled && peer ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Voice call"
              data-testid="voice-call-button"
              onClick={async () => {
                try {
                  await useCallStore.getState().startCall({
                    userId: peer.id,
                    name: title,
                    hasPhoto: Boolean(peer.hasProfilePhoto),
                    photoVersion: peer.photoVersion,
                  })
                } catch (error) {
                  toast.error(getErrorMessage(error))
                }
              }}
            >
              <Phone />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search messages"
            onClick={() => setSearchOpen((value) => !value)}
          >
            {searchOpen ? <X /> : <Search />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Chat menu">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {isGroup && canAddGroupMembers(role, groupSettings(details.data)) ? (
                <DropdownMenuItem onClick={() => setAddMembersOpen(true)}>
                  <UserPlus /> Add member
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => setGroupPanelOpen(true)}>
                <Info /> {isGroup ? 'Group info' : 'Contact info'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setSearchOpen(true)
                }}
              >
                <Search /> Search
              </DropdownMenuItem>
              {isGroup && role && role !== 'owner' ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={async () => {
                      try {
                        await groupsApi.leave(conversationId)
                        closeChat()
                      } catch (error) {
                        toast.error(getErrorMessage(error))
                      }
                    }}
                  >
                    <LogOut /> Exit group
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {searchOpen ? (
        <div className="border-b bg-card px-3 py-2">
          <Input
            autoFocus
            value={messageQuery}
            onChange={(event) => setMessageQuery(event.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
          />
        </div>
      ) : null}
      <RetentionBanner conversationId={conversationId} />
      <div className="min-h-0 flex-1">
        <MessageThread
          key={conversationId}
          conversationId={conversationId}
          messages={messages}
          members={details.data?.members ?? []}
          receipts={receipts.data ?? []}
          currentUserId={user.id}
          isGroup={isGroup}
          conversationType={details.data?.type}
          lastMessageSeq={details.data?.lastMessageSeq ?? 0}
          retentionDays={retention.data?.retentionDays ?? 90}
          searchQuery={messageQuery}
          unreadCount={
            conversationList.data?.data?.find((row) => row.id === conversationId)?.unreadCount ?? 0
          }
        />
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
        canSend={canSend}
      />
      <ChatInfoPanel
        conversation={details.data}
        messages={messages}
        open={groupPanelOpen}
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
