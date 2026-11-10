import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export function SettingsSearch({ value, onChange }) {
  return (
    <label className="relative block">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Find a setting"
        className="h-9 rounded-xl pl-9 text-sm"
        data-testid="settings-search"
      />
      <span className="sr-only">Find a setting</span>
    </label>
  )
}

export function SettingsNavItem({ icon: Icon, label, hint, active, onClick, tint = 'bg-primary/15 text-primary' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`settings-nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors',
        active ? 'bg-accent text-accent-foreground shadow-xs' : 'hover:bg-muted/80',
      )}
    >
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', tint)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{label}</span>
        {hint ? <span className="block truncate text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
    </button>
  )
}

export function SettingsBackHeader({ title, onBack }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-background px-2">
      <button
        type="button"
        onClick={onBack}
        className="flex size-8 items-center justify-center rounded-lg hover:bg-muted"
        aria-label="Back"
        data-testid="settings-back"
      >
        <ChevronLeft className="size-4" />
      </button>
      <h2 className="text-sm font-semibold">{title}</h2>
    </div>
  )
}

export function SettingsPageTitle({ title, hint }) {
  return (
    <div className="mb-5">
      <h2 className="text-[22px] leading-tight font-semibold tracking-tight">{title}</h2>
      {hint ? <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function SettingsGroup({ title, children }) {
  return (
    <section className="space-y-2">
      {title ? (
        <h3 className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      ) : null}
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">{children}</div>
    </section>
  )
}

export function SettingsRow({
  icon: Icon,
  title,
  hint,
  onClick,
  trailing,
  tint = 'bg-muted text-foreground',
  danger = false,
  testId,
}) {
  const inner = (
    <>
      {Icon ? (
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', tint)}>
          <Icon className="size-4" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className={cn('block truncate text-[13px] font-medium', danger && 'text-destructive')}>{title}</span>
        {hint ? <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{hint}</span> : null}
      </span>
      {trailing ?? (onClick ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null)}
    </>
  )
  if (!onClick) {
    return (
      <div data-testid={testId} className="flex items-center gap-3 border-b px-3.5 py-3 last:border-b-0">
        {inner}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-3 border-b px-3.5 py-3 last:border-b-0 transition-colors hover:bg-muted/60"
    >
      {inner}
    </button>
  )
}

export function SettingsFormRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1 border-b px-3.5 py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-6">
      <p className="w-36 shrink-0 text-[13px] font-medium">{label}</p>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function SettingsField({ label, children }) {
  return (
    <div className="block space-y-1">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

export function SettingsStatus({ loading, error, empty, emptyText, children }) {
  if (loading) return <p className="px-3.5 py-4 text-sm text-muted-foreground">Loading…</p>
  if (error) return <p className="px-3.5 py-4 text-sm text-destructive">Could not load this list.</p>
  if (empty) return <p className="px-3.5 py-4 text-sm text-muted-foreground">{emptyText}</p>
  return children
}

export function SettingsPane({ children, className }) {
  return <div className={cn('mx-auto w-full max-w-[760px] space-y-5 p-5', className)}>{children}</div>
}

export function SettingsNested({ title, onBack, children }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SettingsBackHeader title={title} onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
