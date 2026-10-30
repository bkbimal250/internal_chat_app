import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserIdentity } from '@/features/users/UserIdentity'
import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm'
import { useAuth } from '@/hooks/use-auth'
import { usersApi, sessionsApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { formatExactTime } from '@/lib/time'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'
import { useState } from 'react'

export function SettingsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: sessionsApi.list })
  const devices = useQuery({ queryKey: queryKeys.devices, queryFn: sessionsApi.devices })
  const saveName = useMutation({
    mutationFn: () => usersApi.updateMe({ displayName }),
    onSuccess: () => toast.success('Profile updated'),
    onError: (error) => toast.error(getErrorMessage(error)),
  })
  const revoke = useMutation({
    mutationFn: (id) => sessionsApi.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
      toast.success('Session revoked')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-6 overflow-auto p-6">
      <PageHeader eyebrow="Account" title="Settings" description="Manage your profile, password, and signed-in devices." />
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your display name is visible to colleagues.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UserIdentity user={user} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            <Button onClick={() => saveName.mutate()} disabled={saveName.isPending}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Revoke a device if you no longer recognize it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(sessions.data ?? []).map((session) => (
            <div key={session.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">
                  {session.deviceName} {session.current ? '(this device)' : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {session.platform} · last used {formatExactTime(session.lastUsedAt)}
                </p>
              </div>
              {!session.current ? (
                <Button size="sm" variant="outline" onClick={() => revoke.mutate(session.id)}>
                  Revoke
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Devices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(devices.data ?? []).map((device) => (
            <p key={device.id} className="text-sm">
              {device.deviceName} · {device.platform} · last seen {formatExactTime(device.lastSeenAt)}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
