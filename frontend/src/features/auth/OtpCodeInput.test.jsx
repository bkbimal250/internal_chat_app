import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { OtpCodeInput } from '@/features/auth/OtpCodeInput'

function Harness() {
  const [value, setValue] = useState('')
  return <OtpCodeInput value={value} onChange={setValue} />
}

describe('OtpCodeInput', () => {
  afterEach(() => {
    cleanup()
  })

  it('accepts a pasted 6-digit code', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const first = screen.getByTestId('login-otp')
    first.focus()
    await user.paste('123456')
    expect(first).toHaveValue('1')
    expect(screen.getByTestId('login-otp-6')).toHaveValue('6')
  })

  it('moves focus as digits are typed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OtpCodeInput value="" onChange={onChange} />)
    await user.type(screen.getByTestId('login-otp'), '9')
    expect(onChange).toHaveBeenCalledWith('9')
  })
})
