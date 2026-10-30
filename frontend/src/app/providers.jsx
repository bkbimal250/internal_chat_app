import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from '@/stores/auth-store'
import { RealtimeProvider } from '@/features/realtime/RealtimeProvider'

function SessionBootstrap({ children }) {
  const status = useAuthStore((state) => state.status)
  const restoreSession = useAuthStore((state) => state.restoreSession)

  useEffect(() => {
    restoreSession()
  }, [restoreSession])

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Restoring session…</p>
      </div>
    )
  }

  return children
}

export function AppProviders({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SessionBootstrap>
          <RealtimeProvider>{children}</RealtimeProvider>
        </SessionBootstrap>
        <Toaster position="top-right" richColors />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
