import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { AppSidebar } from '@/layouts/AppSidebar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { StatusPill } from '@/components/common/StatusPill'
import { useUiStore } from '@/stores/ui-store'

export function AdminLayout() {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden w-72 shrink-0 lg:block">
        <AppSidebar />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4 lg:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <p className="text-sm font-medium">Administration</p>
          </div>
          <StatusPill label="Admin shell" tone="gold" />
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 border-0 bg-sidebar p-0">
          <SheetTitle className="sr-only">Administration navigation</SheetTitle>
          <AppSidebar onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
