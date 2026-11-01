import { useState } from 'react'
import { useWorkspace } from '@/hooks/use-workspace'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, CornerUpLeft, Download, Forward, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { conversationsApi, messagesApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import {
  REACTION_EMOJIS,
  canCopyMessage,
  canDeleteForEveryone,
  canDeleteForMe,
  canDownloadMessage,
  canForwardMessage,
  canMutateMessage,
  canReactToMessage,
  canReplyPrivately,
  canReplyToMessage,
  hasReacted,
  removeMessage,
  upsertMessage,
} from '@/lib/messages'
import { useUiStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'
import { downloadAttachment } from '@/features/messages/AttachmentViews'

export function MessageActions({ message, currentUserId, isGroup, conversationType, align = 'end' }) {
  const queryClient = useQueryClient()
  const { openChat } = useWorkspace()
  const setReplyTo = useUiStore((state) => state.setReplyTo)
  const setEditing = useUiStore((state) => state.setEditingMessage)
  const setForwarding = useUiStore((state) => state.setForwardingMessage)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const mutable = canMutateMessage(message, currentUserId)
  const everyone = canDeleteForEveryone(message, { currentUserId, conversationType })
  const showMenu = !message.pending && message.messageType !== 'system'
  if (!showMenu) return null

  function patchMessage(updated) {
    queryClient.setQueryData(queryKeys.messages(message.conversationId), (current) => ({
      ...current,
      data: upsertMessage(current?.data ?? [], updated),
    }))
  }

  function dropMessage() {
    queryClient.setQueryData(queryKeys.messages(message.conversationId), (current) => ({
      ...current,
      data: removeMessage(current?.data ?? [], message.id),
    }))
  }

  async function react(emoji) {
    try {
      patchMessage(await messagesApi.react(message.id, emoji))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.content)
      toast.success('Copied')
    } catch {
      toast.error('Unable to copy')
    }
  }

  async function download() {
    try {
      await downloadAttachment(message.attachment)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function replyPrivately() {
    try {
      const chat = await conversationsApi.direct(message.senderId)
      setReplyTo(message)
      openChat(chat.id)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function hide() {
    setBusy(true)
    try {
      await messagesApi.hide(message.id)
      dropMessage()
      setDeleteOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function removeForEveryone() {
    setBusy(true)
    try {
      patchMessage(await messagesApi.remove(message.id))
      setDeleteOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="mt-1 size-7 opacity-50 transition-opacity group-hover:opacity-100"
            aria-label="Message actions"
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-56">
          {canReactToMessage(message) ? (
            <div className="flex items-center justify-between gap-0.5 px-1 py-1">
              {REACTION_EMOJIS.map((emoji) => {
                const current = message.reactions?.find((row) => row.emoji === emoji)
                return (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`React ${emoji}`}
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full text-base hover:bg-muted',
                      hasReacted(current, currentUserId) && 'bg-muted',
                    )}
                    onClick={() => {
                      setMenuOpen(false)
                      react(emoji)
                    }}
                  >
                    {emoji}
                  </button>
                )
              })}
            </div>
          ) : null}
          {canReactToMessage(message) ? <DropdownMenuSeparator /> : null}
          {canReplyToMessage(message) ? (
            <DropdownMenuItem onClick={() => setReplyTo(message)}>
              <CornerUpLeft /> Reply
            </DropdownMenuItem>
          ) : null}
          {canReplyPrivately(message, { currentUserId, isGroup }) ? (
            <DropdownMenuItem onClick={replyPrivately}>
              <CornerUpLeft /> Reply privately
            </DropdownMenuItem>
          ) : null}
          {canCopyMessage(message) ? (
            <DropdownMenuItem onClick={copyText}>
              <Copy /> Copy
            </DropdownMenuItem>
          ) : null}
          {canDownloadMessage(message) ? (
            <DropdownMenuItem onClick={download}>
              <Download /> Download
            </DropdownMenuItem>
          ) : null}
          {canForwardMessage(message) ? (
            <DropdownMenuItem onClick={() => setForwarding(message)}>
              <Forward /> Forward
            </DropdownMenuItem>
          ) : null}
          {mutable && message.messageType === 'text' ? (
            <DropdownMenuItem onClick={() => setEditing(message)}>
              <Pencil /> Edit
            </DropdownMenuItem>
          ) : null}
          {canDeleteForMe(message) ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete message?</DialogTitle>
            <DialogDescription>
              {everyone
                ? 'Delete for me hides it on this device. Delete for everyone replaces it with a tombstone for both of you.'
                : 'This removes the message from your chat only. Other members still see it.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-col sm:space-x-0">
            <Button variant="destructive" disabled={busy} onClick={hide} data-testid="delete-for-me">
              Delete for me
            </Button>
            {everyone ? (
              <Button
                variant="outline"
                className="text-destructive"
                disabled={busy}
                onClick={removeForEveryone}
                data-testid="delete-for-everyone"
              >
                Delete for everyone
              </Button>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ReactionChips({ message, currentUserId, mine }) {
  const queryClient = useQueryClient()
  if (message.deletedAt || !message.reactions?.length) return null
  return (
    <div className={cn('mt-0.5 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
      {message.reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          data-testid={`reaction-${reaction.emoji}`}
          className={cn(
            'rounded-full border bg-card px-1.5 py-0.5 text-xs shadow-xs',
            hasReacted(reaction, currentUserId) && 'border-primary bg-primary/10',
          )}
          onClick={async () => {
            try {
              const updated = await messagesApi.react(message.id, reaction.emoji)
              queryClient.setQueryData(queryKeys.messages(message.conversationId), (current) => ({
                ...current,
                data: upsertMessage(current?.data ?? [], updated),
              }))
            } catch (error) {
              toast.error(getErrorMessage(error))
            }
          }}
        >
          {reaction.emoji} {reaction.count}
        </button>
      ))}
    </div>
  )
}
