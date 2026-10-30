import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { initialsFromName } from '@/lib/utils'

export function UserIdentity({ user, inverted = false }) {
  if (!user) return null
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className={inverted ? 'border border-sidebar-border' : ''}>
        <AvatarFallback className={inverted ? 'bg-sidebar-accent text-sidebar-foreground' : ''}>
          {initialsFromName(user.displayName || user.username)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className={`truncate text-sm font-medium ${inverted ? 'text-sidebar-foreground' : 'text-foreground'}`}>
          {user.displayName}
        </p>
        <p className={`truncate text-xs ${inverted ? 'text-sidebar-foreground/60' : 'text-muted-foreground'}`}>
          @{user.username}
        </p>
      </div>
    </div>
  )
}
