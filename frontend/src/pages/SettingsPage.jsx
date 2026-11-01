import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SettingsShell } from '@/features/settings/SettingsShell'
import { useAuth } from '@/hooks/use-auth'
import { useAuthStore } from '@/stores/auth-store'
import { usersApi } from '@/services/api'
import { queryKeys } from '@/lib/query-keys'

function isNewerProfile(next, current) {
  if (!current?.updatedAt || !next?.updatedAt) return true
  return new Date(next.updatedAt).getTime() >= new Date(current.updatedAt).getTime()
}

export function SettingsPage() {
  const { user, isAdmin } = useAuth()
  const me = useQuery({ queryKey: queryKeys.me, queryFn: usersApi.me })

  useEffect(() => {
    if (!me.data) return
    const current = useAuthStore.getState().user
    if (current?.id === me.data.id && !isNewerProfile(me.data, current)) return
    useAuthStore.setState({ user: me.data })
  }, [me.data])

  return (
    <div className="h-full">
      <SettingsShell user={user ?? me.data} isAdmin={isAdmin} />
    </div>
  )
}
