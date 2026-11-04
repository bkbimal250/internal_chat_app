import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { AuthLayout } from '@/layouts/AuthLayout'
import { LoginPage } from '@/pages/LoginPage'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    login: vi.fn(),
    requestOtp: vi.fn(),
    loginWithOtp: vi.fn(),
  }),
}))

describe('LoginPage', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders the split-screen Phone + OTP experience', () => {
    render(
      <MemoryRouter>
        <AuthLayout>
          <LoginPage />
        </AuthLayout>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('login-card')).toBeInTheDocument()
    expect(screen.getByTestId('login-branding')).toHaveTextContent('Your team. One connected workspace.')
    expect(screen.getByTestId('login-phone')).toBeInTheDocument()
    expect(screen.getByTestId('login-try-another-way')).toBeInTheDocument()
    expect(screen.queryByTestId('login-username')).not.toBeInTheDocument()
  })
})
