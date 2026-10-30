import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { PageHeader } from '@/components/common/PageHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/common/UserAvatar'
import { usersApi, conversationsApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { useAuth } from '@/hooks/use-auth'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'

export function DirectoryPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const directory = useQuery({
    queryKey: queryKeys.directory({ search, page, limit: 20 }),
    queryFn: () => usersApi.directory({ search, page, limit: 20 }),
  })
  const start = useMutation({
    mutationFn: (userId) => conversationsApi.direct(userId),
    onSuccess: (result) => navigate(`/c/${result.id}`),
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-auto p-6">
      <PageHeader eyebrow="People" title="Employee directory" description="Find colleagues and start a private conversation." />
      <Input
        placeholder="Search by name or username"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          setPage(1)
        }}
      />
      {directory.isLoading ? <Skeleton className="h-24" /> : null}
      <ul className="divide-y rounded-xl border bg-card">
        {(directory.data?.data ?? [])
          .filter((person) => person.id !== user?.id)
          .map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-3 p-4" data-testid="directory-person">
              <div className="flex items-center gap-3">
                <UserAvatar name={person.displayName} />
                <div>
                  <p className="font-medium">{person.displayName}</p>
                  <p className="text-sm text-muted-foreground">@{person.username}</p>
                </div>
              </div>
              <Button size="sm" onClick={() => start.mutate(person.id)} disabled={start.isPending}>
                Message
              </Button>
            </li>
          ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={(directory.data?.data?.length ?? 0) < 20}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
