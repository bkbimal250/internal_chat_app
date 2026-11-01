import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { SessionLoading } from '@/features/auth/SessionLoading'

export function GuestGuard({ children }) {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth()

  if (isLoading) return <SessionLoading />
  if (isAuthenticated && mustChangePassword) return <Navigate to="/change-password" replace />
  if (isAuthenticated) return <Navigate to="/" replace />

  return children
}
