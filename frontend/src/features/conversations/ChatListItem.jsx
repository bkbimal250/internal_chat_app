import { BellOff, Check, MoreVertical, Pin } from 'lucide-react'
import { conversationPeer, conversationTitle, isMuted, isPinned, previewText } from '@/lib/conversations'
import { formatMessageTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ChatListItem({
  conversation,
  currentUserId,
  active,
  selected,
  selecting,
  online,
  menuActions,
  onOpen,
  onToggle,
  onContextMenu,
}) {
  const peer = conversationPeer(conversation, currentUserId)
  const title = conversationTitle(conversation, currentUserId)
  const pinned = isPinned(conversation)
  const muted = isMuted(conversation)

  function onClick(event) {
    if (event.shiftKey || event.metaKey || event.ctrlKey || selecting) {
      event.preventDefault()
      onToggle(event)
      return
    }
    onOpen()
  }

  function onKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpen()
    }
    if (event.key === ' ') {
      event.preventDefault()
      onToggle(event)
    }
  }

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        data-testid="conversation-item"
        data-conversation-id={conversation.id}
        aria-selected={selected}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        className={cn(
          'group flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none',
          active && 'bg-accent',
          selected && 'bg-emerald-50',
        )}
      >
        <span className="relative shrink-0">
          {conversation.type === 'group' ? (
            <UserAvatar
              variant="group"
              userId={conversation.id}
              name={title}
              hasPhoto={conversation.hasAvatar}
              photoVersion={conversation.avatarVersion}
            />
          ) : (
            <UserAvatar person={peer} name={title} online={online} />
          )}
          {selected ? (
            <span
              className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white"
              data-testid="selected-check"
            >
              <Check className="size-3" />
            </span>
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{title}</p>
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[11px]">
              {pinned ? <Pin className="size-3 fill-current" data-testid="pin-indicator" /> : null}
              {formatMessageTime(conversation.latestMessage?.createdAt || conversation.updatedAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="text-muted-foreground truncate text-xs">{previewText(conversation.latestMessage)}</p>
            <span className="flex items-center gap-1">
              {muted ? <BellOff className="text-muted-foreground size-3.5" data-testid="mute-indicator" /> : null}
              {conversation.unreadCount > 0 ? (
                <Badge
                  data-testid="unread-count"
                  className="h-5 min-w-5 justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] text-white"
                >
                  {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                </Badge>
              ) : null}
            </span>
          </div>
        </div>
        {menuActions?.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                aria-label="Chat actions"
                data-testid="chat-row-menu"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              {menuActions.map((action) =>
                action.separator ? (
                  <DropdownMenuSeparator key={action.id} />
                ) : (
                  <DropdownMenuItem
                    key={action.id}
                    variant={action.destructive ? 'destructive' : 'default'}
                    onClick={action.onSelect}
                    data-testid={`row-action-${action.id}`}
                  >
                    {action.label}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </li>
  )
}
