import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/common/PageHeader'
import { groupsApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { UserAvatar } from '@/components/common/UserAvatar'
import { EmptyState } from '@/components/common/EmptyState'
import { Users } from 'lucide-react'
import { getErrorMessage } from '@/services/api-error'

export function GroupsPage() {
  const navigate = useNavigate()
  const groups = useQuery({
    queryKey: queryKeys.groups,
    queryFn: groupsApi.list,
  })

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-6 overflow-auto p-6">
      <PageHeader
        eyebrow="Groups"
        title="Your groups"
        description="Open a group chat or create one from the chats sidebar."
      />
      {groups.isError ? <EmptyState title="Unable to load groups" description={getErrorMessage(groups.error)} /> : null}
      {!groups.isLoading && !(groups.data ?? []).length ? (
        <EmptyState icon={Users} title="No groups yet" description="Create a group from Chats to collaborate with a team." />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {(groups.data ?? []).map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/60"
                onClick={() => navigate(`/c/${group.id}`)}
              >
                <UserAvatar name={group.title || 'Group'} />
                <div>
                  <p className="font-medium">{group.title || 'Untitled group'}</p>
                  <p className="text-sm text-muted-foreground">{group.description || 'Group conversation'}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
