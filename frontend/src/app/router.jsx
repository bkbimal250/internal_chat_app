import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ChatLayout } from '@/layouts/ChatLayout'
import { WorkspaceShell } from '@/layouts/WorkspaceShell'
import { LegacyRedirect } from '@/layouts/LegacyRedirect'
import { LoginPage } from '@/pages/LoginPage'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { GuestGuard } from '@/features/auth/GuestGuard'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route
            path="/login"
            element={
              <GuestGuard>
                <LoginPage />
              </GuestGuard>
            }
          />
          <Route
            path="/change-password"
            element={
              <AuthGuard>
                <ChangePasswordPage />
              </AuthGuard>
            }
          />
        </Route>
        <Route
          element={
            <AuthGuard>
              <ChatLayout />
            </AuthGuard>
          }
        >
          <Route path="/" element={<WorkspaceShell />} />
          <Route path="/c/:conversationId" element={<LegacyRedirect view="chats" />} />
          <Route path="/directory" element={<LegacyRedirect view="directory" />} />
          <Route path="/groups" element={<LegacyRedirect view="groups" />} />
          <Route path="/settings" element={<LegacyRedirect view="settings" />} />
          <Route path="/admin" element={<LegacyRedirect view="admin" />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
