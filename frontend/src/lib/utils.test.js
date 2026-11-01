import { describe, expect, it } from 'vitest'
import { contactSubtitle, formatPhone } from '@/lib/utils'

describe('contact display', () => {
  it('formats Indian mobile numbers for the member picker', () => {
    expect(formatPhone('+919876543210')).toBe('+91 98765 43210')
    expect(formatPhone('')).toBe('')
  })

  it('joins username, phone, and employee code', () => {
    expect(
      contactSubtitle({
        username: 'dinesh',
        phoneE164: '+919876543210',
        employeeCode: 'EMP-12',
      }),
    ).toBe('@dinesh · +91 98765 43210 · EMP-12')
  })
})
