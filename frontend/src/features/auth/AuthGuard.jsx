import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { SessionLoading } from '@/features/auth/SessionLoading'

export function AuthGuard({ children }) {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth()
  const location = useLocation()

  if (isLoading) return <SessionLoading />
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  return children
}
