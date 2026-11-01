import { useQuery } from '@tanstack/react-query'
import { Clock3 } from 'lucide-react'
import { retentionApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { formatExactTime } from '@/lib/time'

export function retentionCopy(days = 90) {
  return `Messages older than ${days} days are automatically deleted according to your company's retention policy.`
}

export function RetentionBanner({ conversationId }) {
  const policy = useQuery({ queryKey: queryKeys.retentionPolicy, queryFn: retentionApi.policy })
  const conversation = useQuery({
    queryKey: queryKeys.conversationRetention(conversationId),
    queryFn: () => retentionApi.conversation(conversationId),
    enabled: Boolean(conversationId),
  })
  const days = conversation.data?.retentionDays ?? policy.data?.retentionDays ?? 90
  const next = conversation.data?.nextExpiresAt
  return (
    <div
      className="flex items-start gap-2 border-b bg-amber-50 px-3 py-2 text-xs text-amber-950"
      data-testid="retention-banner"
    >
      <Clock3 className="mt-0.5 size-3.5 shrink-0" />
      <p>
        {retentionCopy(days)}
        {next ? ` Next expiry: ${formatExactTime(next)}.` : ''}
      </p>
    </div>
  )
}
