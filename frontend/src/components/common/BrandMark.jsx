import { cn } from '@/lib/utils'

export function BrandMark({ className, inverted = false }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-xl border text-sm font-semibold',
          inverted
            ? 'border-sidebar-border bg-sidebar-accent text-gold'
            : 'border-border bg-card text-primary',
        )}
        aria-hidden="true"
      >
        CC
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            'font-display text-base leading-none tracking-tight',
            inverted ? 'text-sidebar-foreground' : 'text-foreground',
          )}
        >
          Company Chat
        </p>
        <p className={cn('mt-1 text-xs', inverted ? 'text-sidebar-foreground/60' : 'text-muted-foreground')}>
          Internal workspace
        </p>
      </div>
    </div>
  )
}
