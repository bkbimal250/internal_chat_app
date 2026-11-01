import { useQuery } from '@tanstack/react-query'
import { Monitor } from 'lucide-react'
import {
  SettingsGroup,
  SettingsNested,
  SettingsPageTitle,
  SettingsPane,
  SettingsRow,
  SettingsStatus,
} from '@/features/settings/SettingsControls'
import { asSettingsList } from '@/features/settings/as-list'
import { sessionsApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'
import { formatExactTime } from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

export function DeviceHome({ onOpen }) {
  const devices = useQuery({ queryKey: queryKeys.devices, queryFn: sessionsApi.devices })
  const rows = asSettingsList(devices.data)
  const hint = devices.isPending
    ? 'Checking this computer and browsers'
    : devices.isError
      ? 'Could not load devices'
      : rows.length
        ? `${rows.length} known ${rows.length === 1 ? 'device' : 'devices'}`
        : 'No computers recorded yet'

  return (
    <SettingsPane>
      <SettingsPageTitle title="Devices" hint="Computers and browsers used with this account" />
      <SettingsGroup title="This account">
        <SettingsRow
          icon={Monitor}
          title="Computers and browsers"
          hint={hint}
          onClick={() => onOpen('list')}
          testId="settings-open-devices"
        />
      </SettingsGroup>
    </SettingsPane>
  )
}

export function DeviceListPane({ onBack }) {
  const deviceId = useAuthStore((state) => state.deviceId)
  const devices = useQuery({ queryKey: queryKeys.devices, queryFn: sessionsApi.devices })
  const rows = asSettingsList(devices.data)

  return (
    <SettingsNested title="Computers and browsers" onBack={onBack}>
      <SettingsPane>
        <SettingsGroup title="Known devices">
          <SettingsStatus
            loading={devices.isPending}
            error={devices.isError}
            empty={!rows.length}
            emptyText="No devices recorded yet."
          >
            {rows.map((device) => (
              <SettingsRow
                key={device.id}
                icon={Monitor}
                title={`${device.deviceName}${device.id === deviceId ? ' · this device' : ''}`}
                hint={`${device.platform} · last seen ${formatExactTime(device.lastSeenAt)}`}
                trailing={
                  device.id === deviceId ? <span className="text-[11px] text-muted-foreground">Active</span> : null
                }
              />
            ))}
          </SettingsStatus>
        </SettingsGroup>
      </SettingsPane>
    </SettingsNested>
  )
}
