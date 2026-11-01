import { useMemo, useState } from 'react'
import { useWorkspace } from '@/hooks/use-workspace'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { SearchField } from '@/components/common/SearchField'
import { InfiniteBrowseList } from '@/components/common/InfiniteBrowseList'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Button } from '@/components/ui/button'
import { CreateGroupDialog } from '@/features/groups/CreateGroupDialog'
import { groupsApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { formatMessageTime } from '@/lib/time'
import { getErrorMessage } from '@/services/api-error'

const PAGE_SIZE = 40

function matchesGroup(group, query) {
  if (!query) return true
  const haystack = `${group.title || ''} ${group.description || ''}`.toLowerCase()
  return haystack.includes(query)
}

export function GroupsPage() {
  const { openChat } = useWorkspace()
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const query = search.trim().toLowerCase()

  const groups = useQuery({
    queryKey: queryKeys.groups,
    queryFn: groupsApi.list,
  })

  const filtered = useMemo(
    () => (groups.data ?? []).filter((group) => matchesGroup(group, query)),
    [groups.data, query],
  )
  const visible = filtered.slice(0, visibleCount)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
        <div className="shrink-0 space-y-4 pt-6 pb-4">
          <PageHeader
            eyebrow="Groups"
            title="Your groups"
            description="Open a group chat or create one for a team."
            actions={
              <Button onClick={() => setCreateOpen(true)} data-testid="groups-create">
                <Plus className="size-4" />
                New group
              </Button>
            }
          />
          <SearchField
            id="groups-search"
            value={search}
            onChange={(value) => {
              setSearch(value)
              setVisibleCount(PAGE_SIZE)
            }}
            placeholder="Search groups"
            data-testid="groups-search"
          />
          <p className="text-muted-foreground text-xs" data-testid="groups-count">
            {groups.isLoading
              ? 'Loading groups…'
              : filtered.length
                ? visible.length < filtered.length
                  ? `${visible.length} of ${filtered.length} groups · scroll for more`
                  : `${filtered.length} ${filtered.length === 1 ? 'group' : 'groups'}`
                : search.trim()
                  ? 'No matches'
                  : 'No groups yet'}
          </p>
        </div>
        <InfiniteBrowseList
          className="min-h-0"
          compact
          listKey={query}
          items={visible}
          itemKey={(group) => group.id}
          loading={groups.isLoading}
          fetchingMore={false}
          error={groups.isError ? getErrorMessage(groups.error) : null}
          emptyIcon={Users}
          emptyTitle={search.trim() ? `No groups match “${search.trim()}”` : 'No groups yet'}
          emptyDescription={
            search.trim()
              ? 'Try another name or create a new group.'
              : 'Create a group to start chatting with a team.'
          }
          onEndReached={() => {
            if (visibleCount < filtered.length) setVisibleCount((count) => count + PAGE_SIZE)
          }}
          renderItem={(group) => (
            <button
              type="button"
              className="hover:bg-muted/60 flex w-full items-center gap-3 px-4 py-3 text-left"
              onClick={() => openChat(group.id)}
              data-testid="groups-item"
            >
              <UserAvatar
                variant="group"
                userId={group.id}
                name={group.title || 'Group'}
                hasPhoto={group.hasAvatar}
                photoVersion={group.avatarVersion}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{group.title || 'Untitled group'}</span>
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    {formatMessageTime(group.updatedAt)}
                  </span>
                </span>
                <span className="text-muted-foreground mt-0.5 block truncate text-sm">
                  {group.description || 'Group conversation'}
                </span>
              </span>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </button>
          )}
        />
      </div>
      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
