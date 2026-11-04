import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { AdminGuard } from '@/features/auth/AdminGuard'
import { GuestGuard } from '@/features/auth/GuestGuard'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '@/hooks/use-auth'

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestGuard>
              <p>login page</p>
            </GuestGuard>
          }
        />
        <Route
          path="/change-password"
          element={
            <AuthGuard>
              <p>password page</p>
            </AuthGuard>
          }
        />
        <Route
          path="/"
          element={
            <AuthGuard>
              <p>chat page</p>
            </AuthGuard>
          }
        />
        <Route
          path="/admin"
          element={
            <AuthGuard>
              <AdminGuard>
                <p>admin page</p>
              </AdminGuard>
            </AuthGuard>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('route guards', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows a restoring screen until session restoration finishes', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: true, mustChangePassword: false })
    renderAt('/')
    expect(screen.getByTestId('session-restoring')).toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
    expect(screen.queryByText('chat page')).not.toBeInTheDocument()
  })

  it('sends anonymous users to login', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: false, mustChangePassword: false })
    renderAt('/')
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('protects chat until the first password change is complete', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, isLoading: false, mustChangePassword: true })
    renderAt('/')
    expect(screen.getByText('password page')).toBeInTheDocument()
  })

  it('allows authenticated employees into chat', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, isLoading: false, mustChangePassword: false })
    renderAt('/')
    expect(screen.getByText('chat page')).toBeInTheDocument()
  })

  it('keeps a hard refresh on a protected route until restoration finishes', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: true, mustChangePassword: false, isAdmin: false })
    renderAt('/admin')
    expect(screen.getByTestId('session-restoring')).toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
    expect(screen.queryByText('admin page')).not.toBeInTheDocument()
  })

  it('restores admin access after the server confirms the role', () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      mustChangePassword: false,
      isAdmin: true,
    })
    renderAt('/admin')
    expect(screen.getByText('admin page')).toBeInTheDocument()
  })

  it('keeps non-admins out of admin pages after restoration', () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      mustChangePassword: false,
      isAdmin: false,
    })
    renderAt('/admin')
    expect(screen.getByText('chat page')).toBeInTheDocument()
    expect(screen.queryByText('admin page')).not.toBeInTheDocument()
  })
})
