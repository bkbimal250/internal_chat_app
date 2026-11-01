import { LoaderCircle, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function SearchField({
  id,
  value,
  onChange,
  placeholder,
  searching = false,
  className,
  ...props
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-full bg-card pr-10 pl-10"
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      {searching ? (
        <LoaderCircle className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
      ) : value ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full hover:bg-muted"
          onClick={() => onChange('')}
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}
