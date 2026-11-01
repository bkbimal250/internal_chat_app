import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'
import { formatExactTime } from '@/lib/time'

function bytesLabel(value) {
  const bytes = Number(value || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function RetentionSettings() {
  const queryClient = useQueryClient()
  const report = useQuery({ queryKey: queryKeys.adminRetention, queryFn: adminApi.retention })
  const policy = report.data?.policy
  const preview = report.data?.preview
  const jobs = report.data?.jobs ?? []

  function refresh() {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminRetention })
  }

  const save = useMutation({
    mutationFn: (body) => adminApi.updateRetention(body),
    onSuccess: () => {
      toast.success('Retention policy updated')
      refresh()
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const activate = useMutation({
    mutationFn: adminApi.activateRetention,
    onSuccess: () => {
      toast.success('Scheduled deletion is now active')
      refresh()
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const pause = useMutation({
    mutationFn: adminApi.pauseRetention,
    onSuccess: () => {
      toast.success('Scheduled deletion paused')
      refresh()
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  return (
    <div className="space-y-4" data-testid="admin-retention">
      <Card>
        <CardHeader>
          <CardTitle>Chat retention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Messages and chat media expire from the original send time. Editing or forwarding does not reset the
            deadline. Employee accounts, groups, and profile photos are never deleted by this policy.
          </p>
          <div className="flex flex-wrap gap-2">
            {[30, 90, 180].map((days) => (
              <Button
                key={days}
                type="button"
                size="sm"
                variant={policy?.retentionDays === days ? 'default' : 'outline'}
                onClick={() => save.mutate({ retentionDays: days })}
              >
                {days} days
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(policy?.remindersEnabled)}
              onChange={(event) => save.mutate({ remindersEnabled: event.target.checked })}
            />
            Send 30 / 7 / 1 day advance reminders
          </label>
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="font-medium">{preview?.mode === 'active' ? 'Cleanup is active' : 'Preview / dry-run mode'}</p>
            <p className="text-muted-foreground">
              {preview?.eligibleMessages ?? 0} messages and {bytesLabel(preview?.eligibleBytes)} would be removed if
              cleanup is approved. Oldest message: {formatExactTime(preview?.oldestMessageAt) || 'none'}. Upcoming in 7
              days: {preview?.upcomingIn7Days ?? 0}.
            </p>
          </div>
          {policy?.cleanupEnabled ? (
            <Button type="button" variant="outline" onClick={() => pause.mutate()} disabled={pause.isPending}>
              Pause scheduled deletion
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              data-testid="activate-retention"
              onClick={() => {
                if (
                  window.confirm(
                    'Activate scheduled deletion? Expired chat messages and media will be permanently removed. This cannot be undone in the app.',
                  )
                ) {
                  activate.mutate()
                }
              }}
              disabled={activate.isPending}
            >
              Approve first destructive cleanup
            </Button>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Cleanup jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {jobs.length === 0 ? <li className="text-muted-foreground">No worker jobs yet</li> : null}
            {jobs.map((job) => (
              <li key={job.id} className="rounded-md border px-3 py-2">
                <p className="font-medium">
                  {job.kind} · {job.status}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatExactTime(job.finishedAt || job.startedAt || job.createdAt)}
                  {job.lastError ? ` · ${job.lastError}` : ''}
                  {job.stats?.bytes ? ` · reclaimed ${bytesLabel(job.stats.bytes)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
