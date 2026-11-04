import { useRef } from 'react'

export function OtpCodeInput({ value, onChange, disabled, error }) {
  const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? '')
  const refs = useRef([])

  function setDigit(index, digit) {
    const next = digits.slice()
    next[index] = digit
    onChange(next.join(''))
  }

  function applyCode(code, startIndex = 0) {
    const pasted = String(code).replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    if (startIndex === 0) {
      onChange(pasted)
      refs.current[Math.min(pasted.length, 5)]?.focus()
      return
    }
    const next = digits.slice()
    pasted.split('').forEach((digit, offset) => {
      if (startIndex + offset < 6) next[startIndex + offset] = digit
    })
    onChange(next.join(''))
    refs.current[Math.min(startIndex + pasted.length, 5)]?.focus()
  }

  function handleChange(index, raw) {
    const cleaned = raw.replace(/\D/g, '')
    if (!cleaned) {
      setDigit(index, '')
      return
    }
    if (cleaned.length > 1) {
      applyCode(cleaned, 0)
      return
    }
    setDigit(index, cleaned)
    if (index < 5) refs.current[index + 1]?.focus()
  }

  function handleKeyDown(index, event) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus()
    }
    if (event.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 5) refs.current[index + 1]?.focus()
  }

  function handlePaste(index, event) {
    event.preventDefault()
    applyCode(event.clipboardData.getData('text'), index === 0 ? 0 : index)
  }

  return (
    <div className="flex justify-between gap-1.5 sm:gap-2" role="group" aria-label="6-digit verification code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node
          }}
          value={digit}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoFocus={index === 0}
          pattern="[0-9]*"
          maxLength={6}
          disabled={disabled}
          aria-label={`Digit ${index + 1} of 6`}
          aria-invalid={error ? 'true' : undefined}
          data-testid={index === 0 ? 'login-otp' : `login-otp-${index + 1}`}
          className="border-input h-12 min-w-0 flex-1 rounded-lg border bg-white text-center text-lg font-semibold tracking-widest shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 sm:max-w-12"
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
        />
      ))}
    </div>
  )
}
