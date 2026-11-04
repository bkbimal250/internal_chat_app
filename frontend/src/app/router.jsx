import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ChatLayout } from '@/layouts/ChatLayout'
import { WorkspaceShell } from '@/layouts/WorkspaceShell'
import { LegacyRedirect } from '@/layouts/LegacyRedirect'
import { LoginPage } from '@/pages/LoginPage'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { SessionLoading } from '@/features/auth/SessionLoading'
import { useAuth } from '@/hooks/use-auth'

function ChangePasswordScreen() {
  return (
    <AuthLayout>
      <ChangePasswordPage />
    </AuthLayout>
  )
}

function LoginScreen() {
  return (
    <AuthLayout>
      <LoginPage />
    </AuthLayout>
  )
}

export function AppRoutes() {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth()
  const location = useLocation()

  if (isLoading) return <SessionLoading />

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/" element={<LoginScreen />} />
        <Route path="*" element={<Navigate to="/" replace state={{ from: location }} />} />
      </Routes>
    )
  }

  if (mustChangePassword) {
    return (
      <Routes>
        <Route path="/change-password" element={<ChangePasswordScreen />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/change-password" element={<ChangePasswordScreen />} />
      <Route element={<ChatLayout />}>
        <Route path="/" element={<WorkspaceShell />} />
        <Route path="/c/:conversationId" element={<LegacyRedirect view="chats" />} />
        <Route path="/directory" element={<LegacyRedirect view="directory" />} />
        <Route path="/groups" element={<LegacyRedirect view="groups" />} />
        <Route path="/settings" element={<LegacyRedirect view="settings" />} />
        <Route path="/admin" element={<LegacyRedirect view="admin" />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
