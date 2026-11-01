import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { retentionApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { useWorkspace } from '@/hooks/use-workspace'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatExactTime } from '@/lib/time'

export function NotificationCenter({ collapsed }) {
  const queryClient = useQueryClient()
  const { openChat } = useWorkspace()
  const notifications = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: retentionApi.notifications,
    refetchInterval: 60000,
  })
  const unread = (notifications.data ?? []).filter((row) => !row.readAt).length
  const markRead = useMutation({
    mutationFn: retentionApi.readNotification,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-sidebar-foreground"
          aria-label={unread ? `${unread} notifications` : 'Notifications'}
          data-testid="notification-bell"
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 size-2 rounded-full bg-amber-400" data-testid="notification-unread" />
          ) : null}
          {collapsed ? <span className="sr-only">Notifications</span> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {(notifications.data ?? []).length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No retention reminders</p>
        ) : (
          (notifications.data ?? []).map((row) => (
            <DropdownMenuItem
              key={row.id}
              className="flex flex-col items-start gap-1 whitespace-normal"
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
