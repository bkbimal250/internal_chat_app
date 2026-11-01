import { Virtuoso } from 'react-virtuoso'
import { LoaderCircle } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function ListSkeleton({ rows = 8 }) {
  return (
    <ul className="divide-y">
      {Array.from({ length: rows }).map((_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function InfiniteBrowseList({
  items,
  itemKey,
  renderItem,
  onEndReached,
  loading = false,
  fetchingMore = false,
  error,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  className,
  listKey,
  compact = false,
}) {
  if (loading) {
    return (
      <div className={cn('overflow-hidden rounded-2xl border bg-card', className)}>
        <ListSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('rounded-2xl border bg-card', className)}>
        <EmptyState title="Unable to load" description={error} />
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className={cn('rounded-2xl border bg-card', className)}>
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
      </div>
    )
  }

  const compactHeight = Math.min(Math.max(items.length * 72 + 8, 72), 640)

  return (
    <div className={cn('overflow-hidden rounded-2xl border bg-card', compact && 'h-auto', className)}>
      <Virtuoso
        key={listKey}
        className={compact ? undefined : 'h-full'}
        style={compact ? { height: compactHeight } : undefined}
        data={items}
        computeItemKey={(index, item) => itemKey?.(item) ?? item?.id ?? index}
        endReached={() => onEndReached?.()}
        increaseViewportBy={400}
        overscan={12}
        itemContent={(index, item) => (
          <div className={index > 0 ? 'border-t' : undefined}>{renderItem(item, index)}</div>
        )}
        components={{
          Footer: () =>
            fetchingMore ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 py-3 text-xs">
                <LoaderCircle className="size-3.5 animate-spin" />
                Loading more…
              </div>
            ) : (
              <div className="h-2" />
            ),
        }}
      />
    </div>
  )
}
