import {
  Archive,
  BellOff,
  BellRing,
  MoreVertical,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ChatSelectionToolbar({
  snapshot,
  compact,
  busy,
  onCancel,
  onPin,
  onMute,
  onDelete,
  onArchive,
  onMarkRead,
  onMarkUnread,
}) {
  const pinLabel = snapshot.allPinned ? 'Unpin' : 'Pin'
  const muteLabel = snapshot.allMuted ? 'Unmute' : 'Mute'
  const archiveLabel = snapshot.allArchived ? 'Unarchive' : 'Archive'
  const overflow = [
    ...(compact
      ? [
          { id: 'pin', label: pinLabel, onSelect: onPin },
          { id: 'mute', label: muteLabel, onSelect: onMute },
          { id: 'archive', label: archiveLabel, onSelect: onArchive },
        ]
      : []),
    ...(snapshot.anyUnread ? [{ id: 'read', label: 'Mark as read', onSelect: onMarkRead }] : []),
    ...(snapshot.anyRead ? [{ id: 'unread', label: 'Mark as unread', onSelect: onMarkUnread }] : []),
  ]

  return (
    <div className="flex items-center gap-1 px-2 pt-3" data-testid="chat-selection-toolbar">
      <Button variant="ghost" size="icon" aria-label="Cancel selection" onClick={onCancel} disabled={busy}>
        <X />
      </Button>
      <p className="min-w-0 flex-1 truncate text-sm font-semibold" data-testid="selected-count">
        {snapshot.count} selected
      </p>
      {busy ? (
        <span className="text-muted-foreground px-2 text-xs">Updating…</span>
      ) : (
        <>
          {compact ? null : (
            <Button variant="ghost" size="icon" aria-label={pinLabel} onClick={onPin} data-testid="toolbar-pin">
              {snapshot.allPinned ? <PinOff /> : <Pin />}
            </Button>
          )}
          {compact ? null : (
            <Button variant="ghost" size="icon" aria-label={muteLabel} onClick={onMute} data-testid="toolbar-mute">
              {snapshot.allMuted ? <BellRing /> : <BellOff />}
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Delete" onClick={onDelete} data-testid="toolbar-delete">
            <Trash2 />
          </Button>
          {compact ? null : (
            <Button
              variant="ghost"
              size="icon"
              aria-label={archiveLabel}
              onClick={onArchive}
              data-testid="toolbar-archive"
            >
              <Archive />
            </Button>
          )}
          {overflow.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More" data-testid="toolbar-more">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {overflow.map((action) => (
                  <DropdownMenuItem key={action.id} onClick={action.onSelect} data-testid={`toolbar-more-${action.id}`}>
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      )}
    </div>
  )
}
