import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { IdCard, KeyRound, MonitorSmartphone, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/common/UserAvatar'
import { ChangePasswordForm } from '@/features/auth/ChangePasswordForm'
import { PhotoEditor } from '@/features/users/PhotoEditor'
import { syncUserPhoto } from '@/lib/realtime-events'
import {
  SettingsFormRow,
  SettingsGroup,
  SettingsNested,
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
  SettingsStatus,
} from '@/features/settings/SettingsControls'
import { asSettingsList } from '@/features/settings/as-list'
import { usersApi, sessionsApi, authApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { useAuthStore } from '@/stores/auth-store'
import { formatExactTime } from '@/lib/time'
import { getErrorMessage } from '@/services/api-error'
import { toast } from 'sonner'

export function AccountHome({ user, onOpen }) {
  return (
    <SettingsPane>
      <SettingsPageTitle title="Accounts" hint="Your info, password, and signed-in sessions" />
      <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-3">
        <UserAvatar person={user} className="size-12" tooltip={false} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{user?.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">@{user?.username}</p>
        </div>
      </div>
      <SettingsGroup title="Account settings">
        <SettingsRow
          icon={IdCard}
          title="Your info"
          hint="Name, photo, email, phone, address"
          onClick={() => onOpen('profile')}
          testId="settings-open-profile"
        />
        <SettingsRow
          icon={KeyRound}
          title="Sign-in"
          hint="Change the password for this account"
          onClick={() => onOpen('password')}
          testId="settings-open-signin"
        />
        <SettingsRow
          icon={MonitorSmartphone}
          title="Sessions"
          hint="See where you are signed in and sign out devices"
          onClick={() => onOpen('sessions')}
          testId="settings-open-sessions"
        />
      </SettingsGroup>
    </SettingsPane>
  )
}

function profileForm(user) {
  return {
    displayName: user?.displayName ?? '',
    fullName: user?.fullName ?? user?.displayName ?? '',
    email: user?.email ?? '',
    phone: user?.phoneE164 ?? '',
    address: user?.address ?? '',
  }
}

export function ProfilePane({ user, onBack }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState(() => profileForm(user))
  const [sourceId, setSourceId] = useState(user?.id)
  if (user?.id !== sourceId) {
    setSourceId(user?.id)
    setForm(profileForm(user))
  }

  const saveProfile = useMutation({
    mutationFn: () =>
      usersApi.updateMe({
        displayName: form.displayName,
        fullName: form.fullName,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.me, updated)
      queryClient.invalidateQueries({ queryKey: ['directory'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
      useAuthStore.setState({ user: updated })
      setForm(profileForm(updated))
      toast.success('Profile saved')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  return (
    <SettingsNested title="Your info" onBack={onBack}>
      <SettingsPane>
        <SettingsGroup>
          <PhotoEditor
            person={user}
            initFn={usersApi.initPhoto}
            completeFn={usersApi.completePhoto}
            removeFn={usersApi.removePhoto}
            onChanged={syncUserPhoto}
          />
        </SettingsGroup>
        <SettingsGroup title="Details colleagues can see">
          <SettingsFormRow label="Display name">
            <Input
              className="h-8"
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              data-testid="settings-display-name"
            />
          </SettingsFormRow>
          <SettingsFormRow label="Full name">
            <Input
              className="h-8"
              value={form.fullName}
              onChange={(event) => setForm({ ...form, fullName: event.target.value })}
              data-testid="settings-full-name"
            />
          </SettingsFormRow>
          <SettingsFormRow label="Email">
            <Input
              className="h-8"
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              data-testid="settings-email"
            />
          </SettingsFormRow>
          <SettingsFormRow label="Phone">
            <Input
              className="h-8"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="+91…"
              data-testid="settings-phone"
            />
          </SettingsFormRow>
          <SettingsFormRow label="Address">
            <Input
              className="h-8"
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
              data-testid="settings-address"
            />
          </SettingsFormRow>
          <div className="flex justify-end px-3 py-2.5">
            <Button
              type="button"
              size="sm"
              onClick={() => saveProfile.mutate()}
              disabled={saveProfile.isPending}
              data-testid="settings-save-profile"
            >
              {saveProfile.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SettingsGroup>
      </SettingsPane>
    </SettingsNested>
  )
}

export function SignInPane({ onBack }) {
  return (
    <SettingsNested title="Sign-in" onBack={onBack}>
      <SettingsPane>
        <SettingsGroup title="Password">
          <div className="p-3">
            <p className="mb-3 text-[12px] text-muted-foreground">
              Changing your password signs you out of every device. You will need to sign in again.
            </p>
            <ChangePasswordForm submitClassName="w-auto" />
          </div>
        </SettingsGroup>
      </SettingsPane>
    </SettingsNested>
  )
}

export function SessionsPane({ onBack }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: sessionsApi.list })
  const rows = asSettingsList(sessions.data)
  const others = rows.filter((session) => !session.current)

  const revoke = useMutation({
    mutationFn: (id) => sessionsApi.revoke(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
      toast.success('Session signed out')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })

  async function signOutOthers() {
    try {
      await Promise.all(others.map((session) => sessionsApi.revoke(session.id)))
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
      toast.success('Other sessions signed out')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function signOutEverywhere() {
    try {
      await authApi.logoutAll()
      useAuthStore.getState().reset()
      navigate('/login', { replace: true })
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <SettingsNested title="Sessions" onBack={onBack}>
      <SettingsPane>
        <SettingsGroup title="Signed in">
          <SettingsStatus
            loading={sessions.isPending}
            error={sessions.isError}
            empty={!rows.length}
            emptyText="No active sessions."
          >
            {rows.map((session) => (
              <SettingsRow
                key={session.id}
                icon={MonitorSmartphone}
                title={`${session.deviceName}${session.current ? ' · this device' : ''}`}
                hint={`${session.platform} · last used ${formatExactTime(session.lastUsedAt)}`}
                trailing={
                  session.current ? (
                    <span className="text-[11px] text-muted-foreground">Active</span>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => revoke.mutate(session.id)}
                      disabled={revoke.isPending}
                    >
                      Sign out
                    </Button>
                  )
                }
              />
            ))}
          </SettingsStatus>
        </SettingsGroup>
        <SettingsGroup title="Sign-out options">
          {others.length ? (
            <SettingsRow
              icon={LogOut}
              title="Sign out other sessions"
              hint="Keep this browser signed in"
              onClick={signOutOthers}
              testId="settings-sign-out-others"
            />
          ) : (
            <SettingsRow title="Other sessions" hint="Only this device is signed in" />
          )}
          <SettingsRow
            icon={LogOut}
            title="Sign out everywhere"
            hint="Revoke this session and every other device"
            danger
            onClick={signOutEverywhere}
            testId="settings-sign-out-everywhere"
          />
        </SettingsGroup>
      </SettingsPane>
    </SettingsNested>
  )
}
