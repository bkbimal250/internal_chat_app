import { Users } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'

export function GroupPlaceholder() {
  return (
    <EmptyState
      icon={Users}
      title="Groups are reserved"
      description="Create, member, and ownership tools are intentionally deferred until chat integration."
    />
  )
}
