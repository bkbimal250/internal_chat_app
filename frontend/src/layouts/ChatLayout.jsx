import { Outlet } from 'react-router-dom'
import { LogOut, MessageSquare, Settings, Shield, Users, Contact } from 'lucide-react'
import { BrandMark } from '@/components/common/BrandMark'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useAuth } from '@/hooks/use-auth'
import { useWorkspace } from '@/hooks/use-workspace'
import { useUiStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { NotificationCenter } from '@/features/retention/NotificationCenter'

const links = [
  { view: 'chats', label: 'Chats', icon: MessageSquare },
  { view: 'directory', label: 'People', icon: Contact },
  { view: 'groups', label: 'Groups', icon: Users },
  { view: 'settings', label: 'Settings', icon: Settings },
  { view: 'admin', label: 'Admin', icon: Shield, admin: true },
]

function NavItems({ onNavigate, collapsed }) {
  const { isAdmin } = useAuth()
  const { view, openView } = useWorkspace()
  return links
    .filter((link) => !link.admin || isAdmin)
    .map((link) => {
      const Icon = link.icon
      const isActive = view === link.view
      const item = (
        <button
          key={link.view}
          type="button"
          data-testid={`nav-${link.view}`}
          onClick={() => {
            openView(link.view)
            onNavigate?.()
          }}
          aria-current={isActive ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
            collapsed && 'justify-center px-0',
            isActive
              ? 'bg-sidebar-accent text-sidebar-foreground'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
          )}
        >
          <Icon className="size-4 text-gold" aria-hidden="true" />
          {collapsed ? <span className="sr-only">{link.label}</span> : link.label}
        </button>
      )
      if (!collapsed) return item
      return (
        <Tooltip key={link.view}>
          <TooltipTrigger asChild>{item}</TooltipTrigger>
          <TooltipContent side="right">{link.label}</TooltipContent>
        </Tooltip>
      )
    })
}

function SidebarBody({ collapsed, onNavigate }) {
  const { user, logout } = useAuth()
  const connectionStatus = useUiStore((state) => state.connectionStatus)

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('p-4', collapsed && 'px-2 py-4')}>
        {collapsed ? (
          <div className="flex justify-center">
            <span className="flex size-9 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar-accent text-sm font-semibold text-gold">
              CC
            </span>
          </div>
        ) : (
          <BrandMark inverted />
        )}
      </div>
      <nav className={cn('flex flex-1 flex-col gap-1 px-3', collapsed && 'px-2')} aria-label="Workspace">
        <NavItems collapsed={collapsed} onNavigate={onNavigate} />
      </nav>
      <div className={cn('p-3', collapsed && 'px-2')}>
        <Separator className="mb-3 bg-sidebar-border" />
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <NotificationCenter collapsed={collapsed} />
          <UserAvatar person={user} inverted />
          <div className={cn('min-w-0', collapsed && 'sr-only')}>
            <p className="truncate text-sm font-medium">{user?.displayName}</p>
            <p className="truncate text-xs text-sidebar-foreground/60" data-testid="realtime-status">
              {connectionStatus === 'open' ? 'Realtime connected' : 'Connecting…'}
            </p>
          </div>
        </div>
        <Button
          variant="sidebar"
          className={cn('mt-3 w-full', collapsed && 'px-0')}
          onClick={() => logout()}
          data-testid="sign-out"
        >
          <LogOut className="size-4" />
          {collapsed ? <span className="sr-only">Sign out</span> : 'Sign out'}
        </Button>
      </div>
    </div>
  )
}

export function ChatLayout() {
  const { view } = useWorkspace()
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)
  const chatRoute = view === 'chats'

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-16 shrink-0 lg:block" data-testid="workspace-rail">
        <SidebarBody collapsed />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {!chatRoute ? (
          <header className="flex h-14 items-center gap-2 border-b px-3 lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <MessageSquare />
            </Button>
            <p className="text-sm font-medium">Company Chat</p>
          </header>
        ) : null}
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 border-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
