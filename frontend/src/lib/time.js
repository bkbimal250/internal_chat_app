import { differenceInCalendarDays, format, isToday, isYesterday, parseISO } from 'date-fns'

export function asDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const parsed = typeof value === 'string' ? parseISO(value) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatMessageTime(value) {
  const date = asDate(value)
  if (!date) return ''
  if (isToday(date)) return format(date, 'HH:mm')
  if (isYesterday(date)) return 'Yesterday'
  if (differenceInCalendarDays(new Date(), date) < 7) return format(date, 'EEE')
  return format(date, 'dd MMM')
}

export function formatExactTime(value) {
  const date = asDate(value)
  return date ? format(date, 'dd MMM yyyy, HH:mm') : ''
}

export function formatDateSeparator(value) {
  const date = asDate(value)
  if (!date) return ''
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE, d MMMM yyyy')
}

export function sameDay(a, b) {
  const left = asDate(a)
  const right = asDate(b)
  if (!left || !right) return false
  return format(left, 'yyyy-MM-dd') === format(right, 'yyyy-MM-dd')
}
