import { Button } from '@/components/ui/button'

export function SessionLoading({ message = 'Restoring session…' }) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background"
      data-testid="session-restoring"
    >
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export function SessionUnavailable({ onRetry }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background"
      data-testid="session-unavailable"
    >
      <p className="text-sm text-muted-foreground">Unable to reach the chat service.</p>
      <Button type="button" size="sm" onClick={onRetry} data-testid="session-retry">
        Try again
      </Button>
    </div>
  )
}
