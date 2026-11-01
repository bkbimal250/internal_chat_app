import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { AuthGuard } from '@/features/auth/AuthGuard'
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
      </Routes>
    </MemoryRouter>,
  )
}

describe('route guards', () => {
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
})
