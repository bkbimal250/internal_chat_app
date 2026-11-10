import { Outlet } from 'react-router-dom'
import { LogOut, MessageSquare, Settings, Shield, Users, Contact } from 'lucide-react'
import { BrandMark } from '@/components/common/BrandMark'
import { Button } from '@/components/ui/button'
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

function RailButton({ label, active, collapsed, onClick, testId, children }) {
  const button = (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center rounded-xl text-sm transition-colors',
        collapsed ? 'size-10 justify-center' : 'w-full gap-3 px-3 py-2.5',
        active
          ? 'bg-sidebar-accent text-sidebar-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      {children}
      {collapsed ? <span className="sr-only">{label}</span> : label}
    </button>
  )
  if (!collapsed) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function NavItems({ onNavigate, collapsed }) {
  const { isAdmin } = useAuth()
  const { view, openView } = useWorkspace()
  return links
    .filter((link) => !link.admin || isAdmin)
    .map((link) => {
      const Icon = link.icon
      const isActive = view === link.view
      return (
        <RailButton
          key={link.view}
          label={link.label}
          active={isActive}
          collapsed={collapsed}
          testId={`nav-${link.view}`}
          onClick={() => {
            openView(link.view)
            onNavigate?.()
          }}
        >
          <Icon className={cn('size-[18px]', isActive ? 'text-gold' : 'text-gold/80')} aria-hidden="true" />
        </RailButton>
      )
    })
}

function ProfileCluster({ collapsed, onNavigate }) {
  const { user, logout } = useAuth()
  const { openView } = useWorkspace()
  const connectionStatus = useUiStore((state) => state.connectionStatus)
  const online = connectionStatus === 'open'

  function openProfile() {
    openView('settings')
    onNavigate?.()
  }

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-1 pb-3" data-testid="workspace-profile">
        <p className="sr-only" data-testid="realtime-status">
          {online ? 'Realtime connected' : 'Connecting…'}
        </p>
        <NotificationCenter collapsed />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open profile"
              data-testid="workspace-profile-button"
              onClick={openProfile}
              className="flex size-10 items-center justify-center rounded-xl hover:bg-sidebar-accent"
            >
              <UserAvatar person={user} inverted online={online} className="size-8" tooltip={false} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{user?.displayName || 'Profile'}</TooltipContent>
        </Tooltip>
        <RailButton label="Sign out" collapsed testId="sign-out" onClick={() => logout()}>
          <LogOut className="size-[18px]" />
        </RailButton>
      </div>
    )
  }

  return (
    <div className="px-3 pb-3" data-testid="workspace-profile">
      <div className="rounded-2xl bg-sidebar-accent/80 p-2.5">
        <button
          type="button"
          data-testid="workspace-profile-button"
          onClick={openProfile}
          className="flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-sidebar-accent"
        >
          <UserAvatar person={user} inverted online={online} className="size-10" tooltip={false} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user?.displayName}</span>
            <span className="block truncate text-xs text-sidebar-foreground/60" data-testid="realtime-status">
              {online ? 'Realtime connected' : 'Connecting…'}
            </span>
          </span>
        </button>
        <div className="mt-2 flex items-center gap-1">
          <NotificationCenter />
          <button
            type="button"
            data-testid="sign-out"
            onClick={() => logout()}
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

function SidebarBody({ collapsed, onNavigate }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('px-3 pt-4 pb-3', collapsed && 'px-2')}>
        {collapsed ? (
          <div className="flex justify-center">
            <span className="flex size-10 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar-accent text-sm font-semibold text-gold">
              CC
            </span>
          </div>
        ) : (
          <BrandMark inverted />
        )}
      </div>
      <nav className={cn('flex flex-1 flex-col gap-1 px-3', collapsed && 'items-center px-2')} aria-label="Workspace">
        <NavItems collapsed={collapsed} onNavigate={onNavigate} />
      </nav>
      <ProfileCluster collapsed={collapsed} onNavigate={onNavigate} />
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
