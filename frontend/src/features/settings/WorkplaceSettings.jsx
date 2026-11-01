import { useWorkspace } from '@/hooks/use-workspace'
import { Shield, UserRound, BadgeCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  SettingsGroup,
  SettingsNested,
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
} from '@/features/settings/SettingsControls'

export function WorkplaceHome({ user, isAdmin, onOpen }) {
  return (
    <SettingsPane>
      <SettingsPageTitle title="Workplace" hint="Role and company access for this account" />
      <SettingsGroup title="This account">
        <SettingsRow
          icon={isAdmin ? Shield : UserRound}
          title={isAdmin ? 'Administrator' : 'User'}
          hint={`Signed in as @${user?.username}`}
          onClick={() => onOpen('access')}
          testId="settings-open-access"
        />
        <SettingsRow
          icon={BadgeCheck}
          title={isAdmin ? 'Administration' : 'Managed account'}
          hint={isAdmin ? 'Open employee tools in Admin' : 'An administrator manages this account'}
          onClick={() => onOpen(isAdmin ? 'admin' : 'managed')}
          testId="settings-open-workplace-tools"
        />
      </SettingsGroup>
    </SettingsPane>
  )
}

export function WorkplaceAccessPane({ user, isAdmin, onBack }) {
  return (
    <SettingsNested title="Account type" onBack={onBack}>
      <SettingsPane>
        <SettingsGroup title="Access">
          <SettingsRow
            icon={isAdmin ? Shield : UserRound}
            title={isAdmin ? 'Administrator' : 'User'}
            hint={`@${user?.username}`}
          />
          <SettingsRow title="Status" hint={user?.status === 'active' ? 'Active' : user?.status || 'Unknown'} />
          {user?.employeeCode ? <SettingsRow title="Employee code" hint={user.employeeCode} /> : null}
        </SettingsGroup>
      </SettingsPane>
    </SettingsNested>
  )
}

export function WorkplaceAdminPane({ onBack }) {
  const { openView } = useWorkspace()
  return (
    <SettingsNested title="Administration" onBack={onBack}>
      <SettingsPane>
        <SettingsGroup title="Employee tools">
          <div className="space-y-2 px-3 py-3">
            <p className="text-[12px] text-muted-foreground">
              Create, suspend, and delete employees from the Admin dashboard. Settings here only change your own
              account. You cannot delete your own account or another administrator.
            </p>
            <Button type="button" size="sm" onClick={() => openView('admin')} data-testid="settings-open-admin">
              Open Admin dashboard
            </Button>
          </div>
        </SettingsGroup>
      </SettingsPane>
    </SettingsNested>
  )
}

export function WorkplaceManagedPane({ onBack }) {
  return (
    <SettingsNested title="Managed account" onBack={onBack}>
      <SettingsPane>
        <SettingsGroup title="Company policy">
          <p className="px-3 py-3 text-[12px] text-muted-foreground">
            An administrator created this account. You can update your profile, photo, password, and signed-in
            devices. You cannot delete accounts.
          </p>
        </SettingsGroup>
      </SettingsPane>
    </SettingsNested>
  )
}
