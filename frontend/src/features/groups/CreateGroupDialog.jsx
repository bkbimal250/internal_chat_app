import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '@/hooks/use-workspace'
import { useAuth } from '@/hooks/use-auth'
import { groupsApi, usersApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PHOTO_ACCEPT, uploadProfilePhoto } from '@/features/users/upload-photo'
import { cn, contactSubtitle } from '@/lib/utils'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'

export function CreateGroupDialog({ open, onOpenChange }) {
  const { user } = useAuth()
  const { openChat } = useWorkspace()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])
  const [photo, setPhoto] = useState(null)
  const [preview, setPreview] = useState(null)
  const directory = useQuery({
    queryKey: queryKeys.directory({ search, page: 1, limit: 50 }),
    queryFn: () => usersApi.directory({ search, page: 1, limit: 50 }),
    enabled: open,
  })
  const selectedIds = useMemo(() => new Set(selected.map((person) => person.id)), [selected])
  const contacts = (directory.data?.data ?? []).filter((person) => person.id !== user?.id)

  function toggle(person) {
    setSelected((current) =>
      current.some((row) => row.id === person.id)
        ? current.filter((row) => row.id !== person.id)
        : [...current, person],
    )
  }

  function reset() {
    setTitle('')
    setDescription('')
    setSearch('')
    setSelected([])
    setPhoto(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
  }

  const create = useMutation({
    mutationFn: async () => {
      const conversation = await groupsApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
      })
      if (photo) {
        await uploadProfilePhoto(
          photo,
          (body) => groupsApi.initPhoto(conversation.id, body),
          (body) => groupsApi.completePhoto(conversation.id, body),
        )
      }
      for (const person of selected) {
        await groupsApi.addMember(conversation.id, person.id)
      }
      return conversation
    },
    onSuccess: (conversation) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
      queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      onOpenChange(false)
      reset()
      openChat(conversation.id)
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create group</DialogTitle>
          <DialogDescription>You become the group owner. Add people now or later from Group info.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3">
          <label className="cursor-pointer">
            <UserAvatar
              variant="group"
              name={title || 'Group'}
              src={preview || undefined}
            />
            <input
              type="file"
              accept={PHOTO_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0] || null
                if (preview) URL.revokeObjectURL(preview)
                setPhoto(file)
                setPreview(file ? URL.createObjectURL(file) : null)
              }}
            />
          </label>
          <div className="min-w-0 flex-1 space-y-2">
            <Input
              placeholder="Group name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              data-testid="group-name"
            />
            <Textarea
              placeholder="Description (optional)"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              className="min-h-20"
            />
          </div>
        </div>
        <Input
          placeholder="Search people"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search people"
        />
        {selected.length ? (
          <p className="text-xs text-muted-foreground">{selected.length} selected</p>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {contacts.map((person) => {
            const active = selectedIds.has(person.id)
            return (
              <button
                key={person.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted',
                  active && 'bg-muted',
                )}
                onClick={() => toggle(person)}
              >
                <UserAvatar person={person} tooltip={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{person.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{contactSubtitle(person)}</span>
                </span>
              </button>
            )
          })}
        </div>
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
