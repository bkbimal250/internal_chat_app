import { z } from 'zod'

export const COUNTRY_CODES = [
  { iso: 'IN', dial: '+91', label: 'India (+91)' },
  { iso: 'US', dial: '+1', label: 'United States (+1)' },
  { iso: 'GB', dial: '+44', label: 'United Kingdom (+44)' },
  { iso: 'AE', dial: '+971', label: 'United Arab Emirates (+971)' },
  { iso: 'SG', dial: '+65', label: 'Singapore (+65)' },
  { iso: 'AU', dial: '+61', label: 'Australia (+61)' },
]

export function toE164(countryDial, nationalNumber) {
  const digits = String(nationalNumber ?? '').replace(/\D/g, '')
  return `${countryDial}${digits}`
}

export function splitE164(phoneE164) {
  const value = String(phoneE164 || '')
  const match = COUNTRY_CODES.slice()
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((country) => value.startsWith(country.dial))
  if (!match) {
    return { countryDial: '+91', nationalNumber: value.replace(/^\+/, '') }
  }
  return { countryDial: match.dial, nationalNumber: value.slice(match.dial.length) }
}

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(64, 'Username is too long')
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      'Use letters, numbers, dots, underscores, or hyphens',
    ),
  password: z.string().min(1, 'Password is required').max(128, 'Password is too long'),
})

export const otpRequestSchema = z
  .object({
    countryDial: z.string().regex(/^\+[1-9]\d{0,3}$/, 'Choose a country code'),
    nationalNumber: z
      .string()
      .trim()
      .min(6, 'Enter a valid phone number')
      .max(14, 'Phone number is too long')
      .regex(/^\d+$/, 'Use digits only'),
  })
  .refine((value) => /^\+[1-9]\d{7,14}$/.test(toE164(value.countryDial, value.nationalNumber)), {
    path: ['nationalNumber'],
    message: 'Enter a valid phone number with country code',
  })

export const otpVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(12, 'New password must be at least 12 characters')
      .max(128, 'Password is too long'),
    confirmPassword: z.string().min(1, 'Confirm the new password'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(120),
  fullName: z.string().trim().min(1, 'Full name is required').max(120),
  email: z.union([z.string().email('Enter a valid email').max(254), z.literal('')]).optional(),
  phone: z
    .union([
      z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use an international number starting with +'),
      z.literal(''),
    ])
    .optional(),
  address: z.string().max(500).optional(),
})
