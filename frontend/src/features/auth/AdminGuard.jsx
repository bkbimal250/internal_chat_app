import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { SessionLoading } from '@/features/auth/SessionLoading'

export function AdminGuard({ children }) {
  const { isAdmin, isLoading } = useAuth()

  if (isLoading) return <SessionLoading />
  if (!isAdmin) return <Navigate to="/" replace />

  return children
}
