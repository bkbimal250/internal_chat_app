export function EmptyState({ icon: Icon, title, description }) {
  return (
    <div className="flex h-full min-h-56 flex-col items-center justify-center px-6 text-center">
      {Icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-border bg-card text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      ) : null}
      <h2 className="font-display text-xl tracking-tight">{title}</h2>
      {description ? <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p> : null}
    </div>
  )
}
