import { z } from 'zod'

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

