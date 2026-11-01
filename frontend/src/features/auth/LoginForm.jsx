import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useLocation } from 'react-router-dom'
import { DEFAULT_WORKSPACE, fromLegacyPath } from '@/lib/workspace'
import { useUiStore } from '@/stores/ui-store'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { COUNTRY_CODES, loginSchema, otpRequestSchema, otpVerifySchema, toE164 } from '@/features/auth/schemas'
import { useAuth } from '@/hooks/use-auth'
import { getErrorMessage } from '@/services/api-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

export function LoginForm() {
  const { login, requestOtp, loginWithOtp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)
  const [otpPhone, setOtpPhone] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [expiresIn, setExpiresIn] = useState(0)
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
    const mapped = fromLegacyPath(location.state?.from?.pathname) ?? DEFAULT_WORKSPACE
    useUiStore.getState().openWorkspace(mapped, {
      history: 'none',
      allowAdmin: session.user?.role === 'admin',
    })
    navigate('/', { replace: true })
  }

  async function onPassword(values) {
    try {
      afterLogin(await login(values))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function sendCode(values) {
    try {
      const phone = toE164(values.countryDial, values.nationalNumber)
      const result = await requestOtp(phone)
      setOtpPhone(phone)
      setCooldown(result.retryAfterSeconds ?? 60)
      setExpiresIn(result.expiresInSeconds ?? 300)
      codeForm.reset({ code: '' })
      toast.success('If the number is registered, a code will arrive shortly.')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  async function onVerify(values) {
    try {
      afterLogin(await loginWithOtp({ phone: otpPhone, code: values.code }))
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <Tabs defaultValue="otp" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="otp" data-testid="login-tab-otp">
          Phone & OTP
        </TabsTrigger>
        <TabsTrigger value="password" data-testid="login-tab-password">
          Username & password
        </TabsTrigger>
      </TabsList>
      <TabsContent value="otp" className="pt-4">
        <Form {...phoneForm}>
          <form onSubmit={phoneForm.handleSubmit(sendCode)} className="space-y-4" noValidate>
            <div className="grid grid-cols-[8.5rem_1fr] gap-2">
              <FormField
                control={phoneForm.control}
                name="countryDial"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <select
                        className="border-input h-10 w-full rounded-md border bg-card px-2 text-sm"
                        data-testid="login-country"
                        {...field}
                      >
                        {COUNTRY_CODES.map((country) => (
                          <option key={country.iso} value={country.dial}>
                            {country.label}
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
                    <FormLabel>Phone number</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="tel"
                        autoComplete="tel-national"
                        placeholder="9876543210"
                        data-testid="login-phone"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={phoneForm.formState.isSubmitting || cooldown > 0}
              data-testid="login-otp-send"
            >
              {phoneForm.formState.isSubmitting
                ? 'Sending…'
                : cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : otpPhone
                    ? 'Resend code'
                    : 'Send OTP'}
            </Button>
          </form>
        </Form>
        {otpPhone ? (
          <Form {...codeForm}>
            <form onSubmit={codeForm.handleSubmit(onVerify)} className="mt-5 space-y-4" noValidate>
              <FormField
                control={codeForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Six-digit code</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        data-testid="login-otp"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <p className="text-xs text-muted-foreground">
                {expiresIn > 0 ? `Code expires in ${expiresIn}s.` : 'Request a new code if this one expired.'}
              </p>
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={codeForm.formState.isSubmitting}
                data-testid="login-otp-verify"
              >
                {codeForm.formState.isSubmitting ? 'Verifying…' : 'Verify and sign in'}
              </Button>
            </form>
          </Form>
        ) : null}
      </TabsContent>
      <TabsContent value="password" className="pt-4">
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
                        className="pr-10"
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-0 right-0"
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
              className="w-full"
              size="lg"
              disabled={passwordForm.formState.isSubmitting}
              data-testid="login-submit"
            >
              {passwordForm.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Form>
      </TabsContent>
    </Tabs>
  )
}
