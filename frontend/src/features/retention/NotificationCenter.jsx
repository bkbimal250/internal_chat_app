import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { retentionApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatExactTime } from '@/lib/time'
import { cn } from '@/lib/utils'

export function NotificationCenter({ collapsed }) {
  const queryClient = useQueryClient()
  const { openChat } = useWorkspace()
  const notifications = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: retentionApi.notifications,
    refetchInterval: 60000,
  })
  const rows = notifications.data ?? []
  const unread = rows.filter((row) => !row.readAt).length
  const markRead = useMutation({
    mutationFn: retentionApi.readNotification,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative flex size-10 items-center justify-center rounded-xl text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
            collapsed ? '' : 'shrink-0',
          )}
          aria-label={unread ? `${unread} notifications` : 'Notifications'}
          data-testid="notification-bell"
        >
          <Bell className="size-[18px]" />
          {unread > 0 ? (
            <span
              className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold text-[#1a1a1a]"
              data-testid="notification-unread"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={collapsed ? 'right' : 'top'}
        align={collapsed ? 'end' : 'start'}
        sideOffset={8}
        className="w-80 rounded-2xl p-1.5"
      >
        <div className="px-2.5 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <p className="text-[11px] text-muted-foreground">
            {unread ? `${unread} unread` : 'Retention reminders and alerts'}
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications yet</p>
        ) : (
          rows.map((row) => (
            <DropdownMenuItem
              key={row.id}
              className={cn(
                'flex flex-col items-start gap-1 rounded-xl px-2.5 py-2 whitespace-normal',
                !row.readAt && 'bg-accent/60',
              )}
              onClick={() => {
                if (!row.readAt) markRead.mutate(row.id)
                if (row.conversationId) openChat(row.conversationId)
              }}
            >
              <span className="font-medium">{row.title}</span>
              <span className="text-xs text-muted-foreground">{row.body}</span>
              <span className="text-[11px] text-muted-foreground">{formatExactTime(row.createdAt)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
