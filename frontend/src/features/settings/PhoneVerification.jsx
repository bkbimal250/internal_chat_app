import { useEffect, useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsFormRow } from '@/features/settings/SettingsControls'
import { COUNTRY_CODES, otpRequestSchema, otpVerifySchema, splitE164, toE164 } from '@/features/auth/schemas'
import { usersApi } from '@/services/api'
import { getErrorMessage } from '@/services/api-error'

export function PhoneVerification({ user, onVerified }) {
  const current = splitE164(user?.phoneE164)
  const verified = Boolean(user?.phoneVerifiedAt)
  const [countryDial, setCountryDial] = useState(current.countryDial)
  const [nationalNumber, setNationalNumber] = useState(current.nationalNumber)
  const [otpPhone, setOtpPhone] = useState(verified ? user.phoneE164 : '')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [expiresIn, setExpiresIn] = useState(0)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [codeError, setCodeError] = useState('')
  const awaitingCode = Boolean(otpPhone) && !(verified && otpPhone === user?.phoneE164)

  useEffect(() => {
    if (cooldown <= 0 && expiresIn <= 0) return undefined
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1))
      setExpiresIn((value) => Math.max(0, value - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown, expiresIn])

  async function sendCode() {
    setError('')
    setPhoneError('')
    const parsed = otpRequestSchema.safeParse({ countryDial, nationalNumber })
    if (!parsed.success) {
      setPhoneError(parsed.error.issues[0]?.message || 'Enter a valid mobile number')
      return
    }
    const phone = toE164(countryDial, nationalNumber)
    setSending(true)
    try {
      const result = await usersApi.requestPhoneOtp({ phone })
      setOtpPhone(phone)
      setCode('')
      setCooldown(result.retryAfterSeconds ?? 60)
      setExpiresIn(result.expiresInSeconds ?? 60)
    } catch (caught) {
      setError(getErrorMessage(caught) || 'Unable to send a verification code')
    } finally {
      setSending(false)
    }
  }

  async function verifyCode() {
    setError('')
    setCodeError('')
    const parsed = otpVerifySchema.safeParse({ code })
    if (!parsed.success) {
      setCodeError(parsed.error.issues[0]?.message || 'Enter the 6-digit code')
      return
    }
    setVerifying(true)
    try {
      const updated = await usersApi.verifyPhone({ phone: otpPhone, code })
      setCode('')
      setExpiresIn(0)
      onVerified(updated)
    } catch (caught) {
      setError(getErrorMessage(caught) || 'That verification code is invalid')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <>
      <SettingsFormRow label="Mobile number">
        <div className="space-y-2">
          <div className="grid grid-cols-[8.5rem_1fr] gap-2">
            <select
              className="border-input h-8 w-full rounded-md border bg-card px-2 text-sm"
              value={countryDial}
              onChange={(event) => setCountryDial(event.target.value)}
              data-testid="settings-phone-country"
            >
              {COUNTRY_CODES.map((country) => (
                <option key={country.iso} value={country.dial}>
                  {country.label}
                </option>
              ))}
            </select>
            <Input
              className="h-8"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="9876543210"
              value={nationalNumber}
              onChange={(event) => setNationalNumber(event.target.value)}
              data-testid="settings-phone"
            />
          </div>
          {phoneError ? <p className="text-[12px] text-destructive">{phoneError}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={verified && otpPhone === user?.phoneE164 ? 'outline' : 'default'}
              onClick={sendCode}
              disabled={sending || cooldown > 0}
              data-testid="settings-phone-send-otp"
            >
              {sending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : verified ? 'Send new OTP' : 'Send OTP'}
            </Button>
            {verified ? (
              <span
                className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700"
                data-testid="settings-phone-verified"
              >
                <BadgeCheck className="size-3.5" />
                Verified
              </span>
            ) : (
              <span className="text-[12px] text-muted-foreground">Unverified · required for phone login</span>
            )}
          </div>
        </div>
      </SettingsFormRow>
      {awaitingCode ? (
        <SettingsFormRow label="Verification code">
          <div className="space-y-2">
            <Input
              className="h-8 tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              data-testid="settings-phone-otp"
            />
            {codeError ? <p className="text-[12px] text-destructive">{codeError}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={verifyCode}
                disabled={verifying || code.length !== 6}
                data-testid="settings-phone-verify"
              >
                {verifying ? 'Verifying…' : 'Verify mobile number'}
              </Button>
              {expiresIn > 0 ? (
                <span className="text-[12px] text-muted-foreground">Code expires in {expiresIn}s</span>
              ) : null}
            </div>
          </div>
        </SettingsFormRow>
      ) : null}
      {error ? (
        <p className="px-3 pb-3 text-[12px] text-destructive" data-testid="settings-phone-error">
          {error}
        </p>
      ) : null}
    </>
  )
}
