import { Info } from 'lucide-react'
import {
  SettingsGroup,
  SettingsNested,
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
} from '@/features/settings/SettingsControls'
import { formatExactTime } from '@/lib/time'
import { useQuery } from '@tanstack/react-query'
import { retentionApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { retentionCopy } from '@/features/retention/RetentionBanner'

export function AboutHome({ onOpen }) {
  return (
    <SettingsPane>
      <SettingsPageTitle title="About" hint="Account details for this workspace" />
      <SettingsGroup title="Company Chat">
        <SettingsRow
          icon={Info}
          title="Account details"
          hint="Username, role, and when this account was created"
          onClick={() => onOpen('details')}
          testId="settings-open-about"
        />
      </SettingsGroup>
    </SettingsPane>
  )
}

export function AboutDetailsPane({ user, onBack }) {
  return (
    <SettingsNested title="Account details" onBack={onBack}>
      <SettingsPane>
        <SettingsGroup title="This account">
          <SettingsRow icon={Info} title="Internal workspace" hint="Private employee messaging" />
          <SettingsRow title="Username" hint={`@${user?.username}`} />
          <SettingsRow title="Role" hint={user?.role === 'admin' ? 'Administrator' : 'User'} />
          <SettingsRow title="Account created" hint={formatExactTime(user?.createdAt) || '—'} />
        </SettingsGroup>
        <RetentionPolicyRow />
      </SettingsPane>
    </SettingsNested>
  )
}

function RetentionPolicyRow() {
  const policy = useQuery({ queryKey: queryKeys.retentionPolicy, queryFn: retentionApi.policy })
  const days = policy.data?.retentionDays ?? 90
  return (
    <SettingsGroup title="Chat retention">
      <SettingsRow icon={Info} title={`${days}-day message retention`} hint={retentionCopy(days)} />
    </SettingsGroup>
  )
}
