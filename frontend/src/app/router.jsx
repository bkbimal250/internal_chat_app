import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ChatLayout } from '@/layouts/ChatLayout'
import { LoginPage } from '@/pages/LoginPage'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { AdminGuard } from '@/features/auth/AdminGuard'
import { GuestGuard } from '@/features/auth/GuestGuard'

const ChatPage = lazy(() =>
  import('@/pages/ChatPage').then((module) => ({ default: module.ChatPage })),
)
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)
const DirectoryPage = lazy(() =>
  import('@/pages/DirectoryPage').then((module) => ({ default: module.DirectoryPage })),
)
const GroupsPage = lazy(() =>
  import('@/pages/GroupsPage').then((module) => ({ default: module.GroupsPage })),
)
const AdminDashboardPage = lazy(() =>
  import('@/pages/AdminDashboardPage').then((module) => ({ default: module.AdminDashboardPage })),
)

function ScreenFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading…
    </div>
  )
}

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
          <Route
            path="/"
            element={
              <Suspense fallback={<ScreenFallback />}>
                <ChatPage />
              </Suspense>
            }
          />
          <Route
            path="/c/:conversationId"
            element={
              <Suspense fallback={<ScreenFallback />}>
                <ChatPage />
              </Suspense>
            }
          />
          <Route
            path="/directory"
            element={
              <Suspense fallback={<ScreenFallback />}>
                <DirectoryPage />
              </Suspense>
            }
          />
          <Route
            path="/groups"
            element={
              <Suspense fallback={<ScreenFallback />}>
                <GroupsPage />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<ScreenFallback />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminGuard>
                <Suspense fallback={<ScreenFallback />}>
                  <AdminDashboardPage />
                </Suspense>
              </AdminGuard>
            }
          />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
