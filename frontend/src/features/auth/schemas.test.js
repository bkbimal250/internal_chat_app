import { describe, expect, it } from 'vitest'
import { splitE164, toE164 } from '@/features/auth/schemas'

describe('phone helpers', () => {
  it('builds and splits Indian E.164 numbers', () => {
    expect(toE164('+91', '9876543210')).toBe('+919876543210')
    expect(splitE164('+919876543210')).toEqual({
      countryDial: '+91',
      nationalNumber: '9876543210',
    })
  })
})
