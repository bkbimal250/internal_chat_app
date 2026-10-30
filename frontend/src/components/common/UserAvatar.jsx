import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { initialsFromName } from '@/lib/utils'

export function UserAvatar({ name, online, className, inverted = false }) {
  return (
    <span className="relative inline-flex">
      <Avatar className={cn(inverted && 'border border-sidebar-border', className)}>
        <AvatarFallback className={inverted ? 'bg-sidebar-accent text-sidebar-foreground' : ''}>
          {initialsFromName(name)}
        </AvatarFallback>
      </Avatar>
      {online ? (
        <span
          className="border-background absolute right-0 bottom-0 size-2.5 rounded-full border bg-emerald-500"
          aria-label="Online"
          data-testid="online-indicator"
        />
      ) : null}
    </span>
  )
}
