import { useMemo, useState } from 'react'
import { Building2, Info, Monitor, UserRound } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SettingsNavItem, SettingsRow, SettingsSearch } from '@/features/settings/SettingsControls'
import { AccountHome, ProfilePane, SessionsPane, SignInPane } from '@/features/settings/AccountSettings'
import { DeviceHome, DeviceListPane } from '@/features/settings/DeviceSettings'
import {
  WorkplaceAccessPane,
  WorkplaceAdminPane,
  WorkplaceHome,
  WorkplaceManagedPane,
} from '@/features/settings/WorkplaceSettings'
import { AboutDetailsPane, AboutHome } from '@/features/settings/AboutSettings'

const categories = [
  { id: 'account', label: 'Accounts', hint: 'Your info, password, sessions', icon: UserRound, tint: 'bg-sky-500/15 text-sky-700' },
  { id: 'devices', label: 'Devices', hint: 'Computers and browsers', icon: Monitor, tint: 'bg-emerald-500/15 text-emerald-700' },
  { id: 'workplace', label: 'Workplace', hint: 'Role and company access', icon: Building2, tint: 'bg-primary/15 text-primary' },
  { id: 'about', label: 'About', hint: 'Account details', icon: Info, tint: 'bg-muted text-foreground' },
]

const catalog = [
  { category: 'account', section: 'profile', title: 'Your info', hint: 'Name, photo, email, phone, address', keywords: 'profile name photo email phone address info' },
  { category: 'account', section: 'password', title: 'Sign-in', hint: 'Change password', keywords: 'password login sign-in security' },
  { category: 'account', section: 'sessions', title: 'Sessions', hint: 'Signed-in devices', keywords: 'session revoke logout device' },
  { category: 'devices', section: 'list', title: 'Computers and browsers', hint: 'Devices used with this account', keywords: 'device computer browser' },
  { category: 'workplace', section: 'access', title: 'Account type', hint: 'Role and status', keywords: 'role status employee workplace' },
  { category: 'workplace', section: 'admin', title: 'Administration', hint: 'Employee tools', keywords: 'admin dashboard employees', adminOnly: true },
  { category: 'workplace', section: 'managed', title: 'Managed account', hint: 'Company policy for this user', keywords: 'managed delete policy', userOnly: true },
  { category: 'about', section: 'details', title: 'Account details', hint: 'Username, role, created, retention', keywords: 'about username role status retention expire 90 days' },
]

export function SettingsShell({ user, isAdmin }) {
  const [category, setCategory] = useState('account')
  const [section, setSection] = useState('home')
  const [query, setQuery] = useState('')
  const searching = query.trim().length > 0

  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []
    return catalog.filter((item) => {
      if (item.adminOnly && !isAdmin) return false
      if (item.userOnly && isAdmin) return false
      return `${item.title} ${item.hint} ${item.keywords}`.toLowerCase().includes(term)
    })
  }, [query, isAdmin])

  function openCategory(id) {
    setCategory(id)
    setSection('home')
    setQuery('')
  }

  function openSection(next, nextCategory = category) {
    setCategory(nextCategory)
    setSection(next)
    setQuery('')
  }

  function pane() {
    if (category === 'account' && section === 'profile') return <ProfilePane user={user} onBack={() => setSection('home')} />
    if (category === 'account' && section === 'password') return <SignInPane onBack={() => setSection('home')} />
    if (category === 'account' && section === 'sessions') return <SessionsPane onBack={() => setSection('home')} />
    if (category === 'account') return <AccountHome user={user} onOpen={openSection} />
    if (category === 'devices' && section === 'list') return <DeviceListPane onBack={() => setSection('home')} />
    if (category === 'devices') return <DeviceHome onOpen={openSection} />
    if (category === 'workplace' && section === 'access') {
      return <WorkplaceAccessPane user={user} isAdmin={isAdmin} onBack={() => setSection('home')} />
    }
    if (category === 'workplace' && section === 'admin') {
      return isAdmin ? (
        <WorkplaceAdminPane onBack={() => setSection('home')} />
      ) : (
        <WorkplaceManagedPane onBack={() => setSection('home')} />
      )
    }
    if (category === 'workplace' && section === 'managed') {
      return <WorkplaceManagedPane onBack={() => setSection('home')} />
    }
    if (category === 'workplace') return <WorkplaceHome user={user} isAdmin={isAdmin} onOpen={openSection} />
    if (section === 'details') return <AboutDetailsPane user={user} onBack={() => setSection('home')} />
    return <AboutHome onOpen={openSection} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30" data-testid="settings-shell">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
        <h1 className="text-[15px] font-semibold tracking-tight">Settings</h1>
        <div className="ml-auto w-64 max-w-[50%]">
          <SettingsSearch value={query} onChange={setQuery} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-60 shrink-0 border-r bg-background p-3 lg:block" aria-label="Settings categories">
          <div className="space-y-1">
            {categories.map((item) => (
              <SettingsNavItem
                key={item.id}
                icon={item.icon}
                label={item.label}
                hint={item.hint}
                tint={item.tint}
                active={!searching && category === item.id}
                onClick={() => openCategory(item.id)}
              />
            ))}
          </div>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-1 overflow-x-auto border-b bg-background px-2 py-2 lg:hidden">
            {categories.map((item) => {
              const Icon = item.icon
              const selected = !searching && category === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openCategory(item.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs ${selected ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  <Icon className="size-3.5" />
                  {item.label}
                </button>
              )
            })}
          </div>
          {searching ? (
            <ScrollArea className="h-full">
              <div className="mx-auto w-full max-w-[760px] space-y-2 p-4">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Search results</p>
                <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
                  {results.length ? (
                    results.map((item) => (
                      <SettingsRow
                        key={`${item.category}-${item.section}`}
                        title={item.title}
                        hint={item.hint}
                        onClick={() => openSection(item.section, item.category)}
                      />
                    ))
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No settings match “{query.trim()}”.</p>
                  )}
                </div>
              </div>
            </ScrollArea>
          ) : (
            <div className={section === 'home' ? 'min-h-0 flex-1 overflow-y-auto' : 'min-h-0 flex-1 overflow-hidden'}>
              {pane()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
