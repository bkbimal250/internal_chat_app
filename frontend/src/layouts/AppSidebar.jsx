import { NavLink } from 'react-router-dom'
import { LogOut, MessageSquare, Settings, Shield } from 'lucide-react'
import { BrandMark } from '@/components/common/BrandMark'
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
      <div className="px-4 pt-5 pb-4">
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
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )
                }
              >
                <Icon className="size-[18px] text-gold" aria-hidden="true" />
                {link.label}
              </NavLink>
            )
          })}
      </nav>
      <div className="px-3 pb-3" data-testid="admin-sidebar-profile">
        <div className="rounded-2xl bg-sidebar-accent/80 p-3">
          <UserIdentity user={user} inverted />
          <button
            type="button"
            onClick={() => logout()}
            className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
