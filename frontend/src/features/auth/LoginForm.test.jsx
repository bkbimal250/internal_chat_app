import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from '@/features/auth/LoginForm'
import { ApiError } from '@/services/api-error'

const login = vi.fn()
const requestOtp = vi.fn()
const loginWithOtp = vi.fn()
const openWorkspace = vi.fn()

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ login, requestOtp, loginWithOtp }),
}))

vi.mock('@/stores/ui-store', () => ({
  useUiStore: {
    getState: () => ({ openWorkspace }),
  },
}))

function renderLogin(fromPath) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/', state: fromPath ? { from: { pathname: fromPath } } : undefined }]}>
      <LoginForm />
    </MemoryRouter>,
  )
}

describe('LoginForm', () => {
  afterEach(() => {
    cleanup()
    login.mockReset()
    requestOtp.mockReset()
    loginWithOtp.mockReset()
    openWorkspace.mockReset()
  })

  it('shows Phone + OTP first without a username form', () => {
    renderLogin()
    expect(screen.getByTestId('login-heading')).toHaveTextContent('Welcome to Company Chat')
    expect(screen.getByTestId('login-phone')).toBeInTheDocument()
    expect(screen.getByTestId('login-otp-send')).toBeInTheDocument()
    expect(screen.getByTestId('login-try-another-way')).toBeInTheDocument()
    expect(screen.queryByTestId('login-username')).not.toBeInTheDocument()
    expect(screen.queryByTestId('login-tab-password')).not.toBeInTheDocument()
  })

  it('switches to username and password through Try another way', async () => {
    const user = userEvent.setup()
    renderLogin()
    await user.click(screen.getByTestId('login-try-another-way'))
    expect(screen.getByTestId('login-heading')).toHaveTextContent('Sign in with username')
    expect(screen.getByTestId('login-username')).toBeInTheDocument()
    expect(screen.getByTestId('login-password')).toBeInTheDocument()
    expect(screen.queryByTestId('login-phone')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('login-back-to-otp'))
    expect(screen.getByTestId('login-phone')).toBeInTheDocument()
    expect(screen.getByTestId('login-heading')).toHaveTextContent('Welcome to Company Chat')
  })

  it('requests an OTP through the existing API and verifies the code', async () => {
    const user = userEvent.setup()
    requestOtp.mockResolvedValue({ retryAfterSeconds: 60, expiresInSeconds: 300 })
    loginWithOtp.mockResolvedValue({ user: { role: 'user' } })
    renderLogin('/admin')
    await user.type(screen.getByTestId('login-phone'), '9876543210')
    await user.click(screen.getByTestId('login-otp-send'))
    await waitFor(() => {
      expect(requestOtp).toHaveBeenCalledWith('+919876543210')
    })
    expect(screen.getByTestId('login-heading')).toHaveTextContent('Verify your number')
    expect(screen.getByTestId('login-otp-phone')).toHaveTextContent('+919876543210')
    screen.getByTestId('login-otp').focus()
    await user.paste('123456')
    await user.click(screen.getByTestId('login-otp-verify'))
    await waitFor(() => {
      expect(loginWithOtp).toHaveBeenCalledWith({ phone: '+919876543210', code: '123456' })
    })
    expect(openWorkspace).toHaveBeenCalled()
  })

  it('keeps OTP errors readable and honors the resend cooldown', async () => {
    const user = userEvent.setup()
    requestOtp.mockResolvedValue({ retryAfterSeconds: 60, expiresInSeconds: 300 })
    loginWithOtp.mockRejectedValue(new ApiError({ code: 'INVALID_OTP', message: 'That code is not valid' }))
    renderLogin()
    await user.type(screen.getByTestId('login-phone'), '9876543210')
    await user.click(screen.getByTestId('login-otp-send'))
    await waitFor(() => {
      expect(screen.getByTestId('login-otp-resend')).toBeDisabled()
    })
    expect(screen.getByTestId('login-otp-resend')).toHaveTextContent(/Resend OTP in/)
    screen.getByTestId('login-otp').focus()
    await user.paste('000000')
    await user.click(screen.getByTestId('login-otp-verify'))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('That code is not valid')
    })
  })

  it('keeps the phone form available and explains an unavailable SMS provider', async () => {
    const user = userEvent.setup()
    requestOtp.mockRejectedValue(
      new ApiError({ code: 'SMS_UNAVAILABLE', status: 503, message: 'Internal server error' }),
    )
    renderLogin()
    await user.type(screen.getByTestId('login-phone'), '9876543210')
    await user.click(screen.getByTestId('login-otp-send'))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unable to send verification code right now. Please try again later or use another sign-in method.',
      )
    })
    expect(screen.getByTestId('login-phone')).toHaveValue('9876543210')
    expect(screen.getByTestId('login-otp-send')).toBeEnabled()
  })

  it('signs in with username and password through the existing API', async () => {
    const user = userEvent.setup()
    login.mockResolvedValue({ user: { role: 'user' } })
    renderLogin()
    await user.click(screen.getByTestId('login-try-another-way'))
    await user.type(screen.getByTestId('login-username'), 'jane.doe')
    await user.type(screen.getByTestId('login-password'), 'super-secret-pass')
    await user.click(screen.getByTestId('login-submit'))
    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({ username: 'jane.doe', password: 'super-secret-pass' })
    })
  })
})
