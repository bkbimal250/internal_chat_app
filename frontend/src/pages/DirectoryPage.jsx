import { useMemo, useState } from 'react'
import { useWorkspace } from '@/hooks/use-workspace'
import { keepPreviousData, useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { Contact, MessageSquare } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { SearchField } from '@/components/common/SearchField'
import { InfiniteBrowseList } from '@/components/common/InfiniteBrowseList'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Button } from '@/components/ui/button'
import { usersApi, conversationsApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { useAuth } from '@/hooks/use-auth'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePresenceStore } from '@/stores/ui-store'
import { contactSubtitle } from '@/lib/utils'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'

const PAGE_SIZE = 30

export function DirectoryPage() {
  const { user } = useAuth()
  const { openChat: openWorkspaceChat } = useWorkspace()
  const [search, setSearch] = useState('')
  const [startingId, setStartingId] = useState(null)
  const query = useDebouncedValue(search.trim(), 200)
  const onlineMap = usePresenceStore((state) => state.online)

  const directory = useInfiniteQuery({
    queryKey: queryKeys.directory({ search: query, limit: PAGE_SIZE }),
    queryFn: ({ pageParam }) => usersApi.directory({ search: query, page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.limit
      return loaded < lastPage.total ? lastPage.page + 1 : undefined
    },
    placeholderData: keepPreviousData,
  })

  const people = useMemo(
    () =>
      (directory.data?.pages ?? [])
        .flatMap((page) => page.data ?? [])
        .filter((person) => person.id !== user?.id),
    [directory.data, user?.id],
  )
  const total = directory.data?.pages?.[0]?.total ?? people.length
  const searching = search.trim() !== query || (directory.isFetching && !directory.isFetchingNextPage)

  const start = useMutation({
    mutationFn: (userId) => conversationsApi.direct(userId),
    onMutate: (userId) => setStartingId(userId),
    onSuccess: (result) => openWorkspaceChat(result.id),
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => setStartingId(null),
  })

  function openChat(person) {
    if (start.isPending) return
    start.mutate(person.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
        <div className="shrink-0 space-y-4 pt-6 pb-4">
          <PageHeader
            eyebrow="People"
            title="Employee directory"
            description="Find colleagues and start a private conversation."
          />
          <SearchField
            id="directory-search"
            value={search}
            onChange={setSearch}
            placeholder="Search by name or username"
            searching={searching && Boolean(search)}
            data-testid="directory-search"
          />
          <p className="text-muted-foreground text-xs" data-testid="directory-count">
            {directory.isLoading
              ? 'Loading colleagues…'
              : people.length
                ? directory.hasNextPage
                  ? `${people.length} of ${Math.max(total - 1, people.length)} people · scroll for more`
                  : `${people.length} ${people.length === 1 ? 'person' : 'people'}`
                : search.trim()
                  ? 'No matches'
                  : 'No colleagues yet'}
          </p>
        </div>
        <InfiniteBrowseList
          className="min-h-0 flex-1"
          listKey={query}
          items={people}
          itemKey={(person) => person.id}
          loading={directory.isLoading}
          fetchingMore={directory.isFetchingNextPage}
          error={directory.isError ? getErrorMessage(directory.error) : null}
          emptyIcon={Contact}
          emptyTitle={search.trim() ? `No one matches “${search.trim()}”` : 'No colleagues yet'}
          emptyDescription={
            search.trim()
              ? 'Try a different name, @username, or phone number.'
              : 'Employees appear here as soon as accounts are created.'
          }
          onEndReached={() => {
            if (directory.hasNextPage && !directory.isFetchingNextPage) directory.fetchNextPage()
          }}
          renderItem={(person) => {
            const busy = startingId === person.id
            return (
              <div
                className="hover:bg-muted/60 flex items-center gap-3 px-4 py-3"
                data-testid="directory-person"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => openChat(person)}
                >
                  <UserAvatar person={person} online={Boolean(onlineMap[person.id])} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{person.displayName}</span>
                    <span className="text-muted-foreground block truncate text-sm">
                      {contactSubtitle(person) || `@${person.username}`}
                    </span>
                  </span>
                </button>
                <Button
                  size="sm"
                  onClick={() => openChat(person)}
                  disabled={start.isPending}
                  aria-label={`Message ${person.displayName}`}
                >
                  <MessageSquare className="size-3.5" />
                  {busy ? 'Opening…' : 'Message'}
                </Button>
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}
