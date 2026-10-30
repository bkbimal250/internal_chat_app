import { cn } from '@/lib/utils'

export function StatusPill({ label, tone = 'neutral' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        tone === 'gold' && 'border-primary/30 bg-primary/10 text-[oklch(0.42_0.08_80)]',
        tone === 'slate' && 'border-sidebar-border bg-sidebar text-sidebar-foreground',
        tone === 'neutral' && 'border-border bg-card text-muted-foreground',
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {label}
    </span>
  )
}
