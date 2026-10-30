import { NavLink } from 'react-router-dom'
import { LogOut, MessageSquare, Settings, Shield } from 'lucide-react'
import { BrandMark } from '@/components/common/BrandMark'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { UserIdentity } from '@/features/users/UserIdentity'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

const links = [
  { to: '/', label: 'Messages', icon: MessageSquare, end: true },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/admin', label: 'Admin', icon: Shield, admin: true },
]

export function AppSidebar({ onNavigate }) {
  const { user, isAdmin, logout } = useAuth()

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="p-5">
        <BrandMark inverted />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Workspace">
        {links
          .filter((link) => !link.admin || isAdmin)
          .map((link) => {
            const Icon = link.icon
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )
                }
              >
                <Icon className="size-4 text-gold" aria-hidden="true" />
                {link.label}
              </NavLink>
            )
          })}
      </nav>
      <div className="p-4">
        <Separator className="mb-4 bg-sidebar-border" />
        <UserIdentity user={user} inverted />
        <Button
          variant="sidebar"
          className="mt-3 w-full justify-start"
          onClick={() => logout()}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </div>
  )
}
