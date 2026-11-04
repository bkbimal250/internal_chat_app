import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useLocation } from 'react-router-dom'
import { DEFAULT_WORKSPACE, fromLegacyPath } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { Eye, EyeOff } from 'lucide-react'
import { COUNTRY_CODES, loginSchema, otpRequestSchema, otpVerifySchema, toE164 } from '@/features/auth/schemas'
import { OtpCodeInput } from '@/features/auth/OtpCodeInput'
import { useAuth } from '@/hooks/use-auth'
import { getErrorMessage } from '@/services/api-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

const fieldClass = 'h-12 rounded-lg bg-white text-base md:text-base'

export function LoginForm() {
  const { login, requestOtp, loginWithOtp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [method, setMethod] = useState('phone')
  const [showPassword, setShowPassword] = useState(false)
  const [otpPhone, setOtpPhone] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [expiresIn, setExpiresIn] = useState(0)
  const [formError, setFormError] = useState('')
  const passwordForm = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })
  const phoneForm = useForm({
    resolver: zodResolver(otpRequestSchema),
    defaultValues: { countryDial: '+91', nationalNumber: '' },
  })
  const codeForm = useForm({
    resolver: zodResolver(otpVerifySchema),
    defaultValues: { code: '' },
  })

  useEffect(() => {
    if (cooldown <= 0 && expiresIn <= 0) return undefined
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1))
      setExpiresIn((value) => Math.max(0, value - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown, expiresIn])

  function afterLogin(session) {
    if (session.user?.mustChangePassword) {
      navigate('/change-password', { replace: true })
      return
    }
    const fromPath = location.state?.from?.pathname
    const mapped = fromLegacyPath(fromPath) ?? DEFAULT_WORKSPACE
    useUiStore.getState().openWorkspace(mapped, {
      history: 'none',
      allowAdmin: session.user?.role === 'admin',
    })
    const nextPath = fromPath && fromPath !== '/' && fromPath !== '/login' ? fromPath : '/'
    navigate(nextPath, { replace: true })
  }

  async function onPassword(values) {
    setFormError('')
    try {
      afterLogin(await login(values))
    } catch (error) {
      setFormError(getErrorMessage(error))
    }
  }

  async function sendCode(values) {
    setFormError('')
    try {
      const phone = toE164(values.countryDial, values.nationalNumber)
      const result = await requestOtp(phone)
      setOtpPhone(phone)
      setCooldown(result.retryAfterSeconds ?? 60)
      setExpiresIn(result.expiresInSeconds ?? 300)
      codeForm.reset({ code: '' })
      setMethod('otp')
    } catch (error) {
      setFormError(getErrorMessage(error))
    }
  }

  async function resendCode() {
    if (cooldown > 0 || !otpPhone) return
    const values = phoneForm.getValues()
    await sendCode(values)
  }

  async function onVerify(values) {
    setFormError('')
    try {
      afterLogin(await loginWithOtp({ phone: otpPhone, code: values.code }))
    } catch (error) {
      setFormError(getErrorMessage(error))
    }
  }

  const heading =
    method === 'password'
      ? 'Sign in with username'
      : method === 'otp'
        ? 'Verify your number'
        : 'Welcome to Company Chat'
  const description =
    method === 'password'
      ? 'Use your company account credentials.'
      : method === 'otp'
        ? 'Enter the 6-digit code sent to your mobile number.'
        : 'Enter your mobile number to sign in.'

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-2xl tracking-tight text-[#171E25] sm:text-3xl" data-testid="login-heading">
          {heading}
        </h1>
        <p className="text-sm leading-relaxed text-[#66717D]" data-testid="login-description">
          {description}
        </p>
        {method === 'otp' && otpPhone ? (
          <p className="text-sm font-medium text-[#171E25]" data-testid="login-otp-phone">
            {otpPhone}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p
          className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
          aria-live="assertive"
        >
          {formError}
        </p>
      ) : null}

      {method === 'phone' ? (
        <Form {...phoneForm}>
          <form onSubmit={phoneForm.handleSubmit(sendCode)} className="space-y-5" noValidate>
            <div className="space-y-2">
              <p className="text-sm font-medium" id="login-phone-label">
                Mobile number
              </p>
              <div className="grid grid-cols-[6.75rem_1fr] gap-2 sm:grid-cols-[7.5rem_1fr]">
                <FormField
                  control={phoneForm.control}
                  name="countryDial"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="sr-only">Country code</FormLabel>
                      <FormControl>
                        <select
                          className={`border-input ${fieldClass} w-full border px-2`}
                          data-testid="login-country"
                          aria-label="Country code"
                          {...field}
                        >
                          {COUNTRY_CODES.map((country) => (
                            <option key={country.iso} value={country.dial}>
                              {country.dial}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={phoneForm.control}
                  name="nationalNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="sr-only">Enter mobile number</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="tel"
                          autoComplete="tel-national"
                          autoFocus
                          placeholder="Enter your 10-digit mobile number"
                          data-testid="login-phone"
                          aria-labelledby="login-phone-label"
                          className={fieldClass}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <Button
              type="submit"
              className="h-12 w-full text-base"
              size="lg"
              disabled={phoneForm.formState.isSubmitting || cooldown > 0}
              data-testid="login-otp-send"
            >
              {phoneForm.formState.isSubmitting ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send OTP'}
            </Button>
          </form>
        </Form>
      ) : null}

      {method === 'otp' ? (
        <Form {...codeForm}>
          <form onSubmit={codeForm.handleSubmit(onVerify)} className="space-y-5" noValidate>
            <FormField
              control={codeForm.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Enter 6-digit code</FormLabel>
                  <FormControl>
                    <OtpCodeInput
                      value={field.value}
                      onChange={field.onChange}
                      disabled={codeForm.formState.isSubmitting}
                      error={Boolean(codeForm.formState.errors.code)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-sm text-[#66717D]">
              {expiresIn > 0 ? `Code expires in ${expiresIn}s.` : 'Request a new code if this one expired.'}
            </p>
            <Button
              type="submit"
              className="h-12 w-full text-base"
              size="lg"
              disabled={codeForm.formState.isSubmitting}
              data-testid="login-otp-verify"
            >
              {codeForm.formState.isSubmitting ? 'Verifying…' : 'Verify & Sign in'}
            </Button>
            <div className="flex flex-col items-center gap-2 text-sm">
              <button
                type="button"
                className="text-[#171E25] underline-offset-4 hover:underline disabled:opacity-50"
                disabled={cooldown > 0 || phoneForm.formState.isSubmitting}
                data-testid="login-otp-resend"
                onClick={resendCode}
              >
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
              </button>
              <button
                type="button"
                className="text-[#66717D] underline-offset-4 hover:underline"
                data-testid="login-change-phone"
                onClick={() => {
                  setMethod('phone')
                  setFormError('')
                  codeForm.reset({ code: '' })
                }}
              >
                Change phone number
              </button>
            </div>
          </form>
        </Form>
      ) : null}

      {method === 'password' ? (
        <Form {...passwordForm}>
          <form onSubmit={passwordForm.handleSubmit(onPassword)} className="space-y-5" noValidate>
            <FormField
              control={passwordForm.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="username"
                      placeholder="jane.doe"
                      data-testid="login-username"
                      className={fieldClass}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={passwordForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <div className="relative">
                    <FormControl>
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        data-testid="login-password"
                        className={`${fieldClass} pr-12`}
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-1 right-1 size-10"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      data-testid="login-password-toggle"
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="h-12 w-full text-base"
              size="lg"
              disabled={passwordForm.formState.isSubmitting}
              data-testid="login-submit"
            >
              {passwordForm.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Form>
      ) : null}

      {method === 'password' ? (
        <button
          type="button"
          className="mx-auto block text-sm text-[#66717D] underline-offset-4 hover:text-[#171E25] hover:underline"
          data-testid="login-back-to-otp"
          onClick={() => {
            setMethod('phone')
            setFormError('')
          }}
        >
          Back to Phone & OTP
        </button>
      ) : null}

      {method === 'phone' ? (
        <button
          type="button"
          className="mx-auto block text-sm text-[#66717D] underline-offset-4 hover:text-[#171E25] hover:underline"
          data-testid="login-try-another-way"
          onClick={() => {
            setMethod('password')
            setFormError('')
          }}
        >
          Try another way
        </button>
      ) : null}
    </div>
  )
}
