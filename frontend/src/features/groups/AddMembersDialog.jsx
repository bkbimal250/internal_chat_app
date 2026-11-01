import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Search, X } from 'lucide-react'
import { groupsApi, usersApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn, contactSubtitle } from '@/lib/utils'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'

export function AddMembersDialog({ open, onOpenChange, conversationId, members = [], onAdded }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members])
  const selectedIds = useMemo(() => new Set(selected.map((person) => person.id)), [selected])

  const directory = useQuery({
    queryKey: queryKeys.directory({ search, page: 1, limit: 50 }),
    queryFn: () => usersApi.directory({ search, page: 1, limit: 50 }),
    enabled: open,
  })

  const contacts = (directory.data?.data ?? []).filter((person) => !memberIds.has(person.id))

  function toggle(person) {
    setSelected((current) =>
      current.some((row) => row.id === person.id)
        ? current.filter((row) => row.id !== person.id)
        : [...current, person],
    )
  }

  function close() {
    if (busy) return
    setSearch('')
    setSelected([])
    onOpenChange(false)
  }

  async function confirm() {
    if (!selected.length || busy) return
    setBusy(true)
    try {
      for (const person of selected) {
        await groupsApi.addMember(conversationId, person.id)
      }
      toast.success(selected.length === 1 ? `Added ${selected[0].displayName}` : `Added ${selected.length} members`)
      await onAdded?.()
      setSearch('')
      setSelected([])
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        showClose={false}
        overlayClassName="z-[70]"
        className="z-[80] flex h-[min(36rem,90dvh)] w-[min(28rem,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        data-testid="add-members-dialog"
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="icon" className="size-8" onClick={close} aria-label="Close">
              <X className="size-4" />
            </Button>
            <div className="min-w-0">
              <DialogTitle className="text-base">Add member</DialogTitle>
              <DialogDescription className="text-xs">
                {selected.length ? `${selected.length} selected` : 'Choose people to add to this group'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="shrink-0 px-4 py-3">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, number or @username"
              className="h-10 rounded-full pl-9"
              data-testid="add-member-search"
              autoFocus
            />
          </div>
        </div>

        {selected.length ? (
          <div className="shrink-0 border-b px-4 pb-3">
            <div className="flex max-h-28 flex-wrap content-start gap-2 overflow-y-auto pr-1">
              {selected.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  className="bg-muted hover:bg-muted/80 flex max-w-full items-center gap-1.5 rounded-full py-1 pr-2 pl-1"
                  onClick={() => toggle(person)}
                  aria-label={`Remove ${person.displayName}`}
                >
                  <UserAvatar person={person} tooltip={false} className="size-6" fallbackClassName="text-[9px]" />
                  <span className="max-w-28 truncate text-xs font-medium">{person.displayName}</span>
                  <X className="text-muted-foreground size-3 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="text-muted-foreground shrink-0 px-4 pt-2 pb-1 text-xs font-medium tracking-wide uppercase">
          Contacts
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {directory.isLoading ? (
            <p className="text-muted-foreground px-4 py-6 text-sm">Loading colleagues…</p>
          ) : null}
          {!directory.isLoading && !contacts.length ? (
            <p className="text-muted-foreground px-4 py-6 text-sm">No matching employees.</p>
          ) : null}
          {contacts.map((person) => {
            const checked = selectedIds.has(person.id)
            const subtitle = contactSubtitle(person)
            return (
              <button
                key={person.id}
                type="button"
                data-testid="add-member"
                aria-pressed={checked}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/70"
                onClick={() => toggle(person)}
              >
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border',
                    checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-muted-foreground/40',
                  )}
                >
                  {checked ? <Check className="size-3 stroke-[3]" /> : null}
                </span>
                <UserAvatar person={person} tooltip={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{person.displayName}</span>
                  {subtitle ? (
                    <span className="text-muted-foreground block truncate text-xs">{subtitle}</span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button type="button" variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={!selected.length || busy}
            data-testid="confirm-add-members"
          >
            {busy ? 'Adding…' : selected.length > 1 ? `Add ${selected.length}` : 'Add'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
