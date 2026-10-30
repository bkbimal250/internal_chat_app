import { useAuthStore } from '@/stores/auth-store'

export function useAuth() {
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)
  const login = useAuthStore((state) => state.login)
  const logout = useAuthStore((state) => state.logout)
  const restoreSession = useAuthStore((state) => state.restoreSession)
  const changePassword = useAuthStore((state) => state.changePassword)

  return {
    status,
    user,
    login,
    logout,
    restoreSession,
    changePassword,
    isAuthenticated: status === 'authenticated',
    isAdmin: user?.role === 'admin',
    mustChangePassword: Boolean(user?.mustChangePassword),
    isLoading: status === 'idle' || status === 'loading',
  }
}
