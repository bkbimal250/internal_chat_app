import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useFeaturesStore } from '@/stores/features-store'
import { RealtimeProvider } from '@/features/realtime/RealtimeProvider'
import { SessionLoading, SessionUnavailable } from '@/features/auth/SessionLoading'

function SessionBootstrap({ children }) {
  const status = useAuthStore((state) => state.status)
  const restoreSession = useAuthStore((state) => state.restoreSession)

  useEffect(() => {
    restoreSession()
    useFeaturesStore.getState().load()
  }, [restoreSession])

  if (status === 'initializing') {
    return <SessionLoading />
  }

  if (status === 'unavailable') {
    return <SessionUnavailable onRetry={() => restoreSession()} />
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
