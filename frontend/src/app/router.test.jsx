import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { AppRoutes } from '@/app/router'
import { AuthGuard } from '@/features/auth/AuthGuard'
import { AdminGuard } from '@/features/auth/AdminGuard'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/layouts/ChatLayout', async () => {
  const { Outlet } = await import('react-router-dom')
  return {
    ChatLayout: () => (
      <div data-testid="chat-layout">
        <Outlet />
      </div>
    ),
  }
})

vi.mock('@/layouts/WorkspaceShell', () => ({
  WorkspaceShell: () => <p>workspace shell</p>,
}))

vi.mock('@/pages/LoginPage', () => ({
  LoginPage: () => <p>login page</p>,
}))

vi.mock('@/pages/ChangePasswordPage', () => ({
  ChangePasswordPage: () => <p>password page</p>,
}))

import { useAuth } from '@/hooks/use-auth'

function renderApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('root login routing', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows a restoring screen until session restoration finishes', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: true, mustChangePassword: false })
    renderApp('/')
    expect(screen.getByTestId('session-restoring')).toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
    expect(screen.queryByText('workspace shell')).not.toBeInTheDocument()
  })

  it('shows Phone + OTP login at / when logged out', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: false, mustChangePassword: false })
    renderApp('/')
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('replaces /login with / for guests', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: false, mustChangePassword: false })
    renderApp('/login')
    await waitFor(() => {
      expect(screen.getByText('login page')).toBeInTheDocument()
    })
  })

  it('sends unauthenticated users from protected routes to /', async () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: false, mustChangePassword: false })
    renderApp('/admin')
    await waitFor(() => {
      expect(screen.getByText('login page')).toBeInTheDocument()
    })
  })

  it('keeps a hard refresh on a protected route until restoration finishes', () => {
    useAuth.mockReturnValue({ isAuthenticated: false, isLoading: true, mustChangePassword: false, isAdmin: false })
    renderApp('/admin')
    expect(screen.getByTestId('session-restoring')).toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })

  it('lets authenticated employees into the workspace at /', () => {
    useAuth.mockReturnValue({ isAuthenticated: true, isLoading: false, mustChangePassword: false })
    renderApp('/')
    expect(screen.getByText('workspace shell')).toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })

  it('replaces /login with the workspace when already signed in', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true, isLoading: false, mustChangePassword: false })
    renderApp('/login')
    await waitFor(() => {
      expect(screen.getByText('workspace shell')).toBeInTheDocument()
    })
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })

  it('protects chat until the first password change is complete', async () => {
    useAuth.mockReturnValue({ isAuthenticated: true, isLoading: false, mustChangePassword: true })
    renderApp('/')
    await waitFor(() => {
      expect(screen.getByText('password page')).toBeInTheDocument()
    })
  })
})

describe('admin guard', () => {
  afterEach(() => {
    cleanup()
  })

  function renderAdmin() {
    return render(
      <MemoryRouter initialEntries={['/admin']}>
        <AuthGuard>
          <AdminGuard>
            <p>admin page</p>
          </AdminGuard>
        </AuthGuard>
      </MemoryRouter>,
    )
  }

  it('restores admin access after the server confirms the role', () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      mustChangePassword: false,
      isAdmin: true,
    })
    renderAdmin()
    expect(screen.getByText('admin page')).toBeInTheDocument()
  })

  it('keeps non-admins out of admin pages after restoration', () => {
    useAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      mustChangePassword: false,
      isAdmin: false,
    })
    renderAdmin()
    expect(screen.queryByText('admin page')).not.toBeInTheDocument()
  })
})
