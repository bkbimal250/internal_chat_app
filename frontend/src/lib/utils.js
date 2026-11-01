import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function getDeviceName() {
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Web'
  return `Company Chat (${platform})`.slice(0, 120)
}

export function formatPhone(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('+91') && raw.length === 13) return `+91 ${raw.slice(3, 8)} ${raw.slice(8)}`
  return raw
}

export function contactSubtitle(person) {
  const parts = []
  if (person?.username) parts.push(`@${person.username}`)
  const phone = formatPhone(person?.phoneE164)
  if (phone) parts.push(phone)
  if (person?.employeeCode) parts.push(person.employeeCode)
  return parts.join(' · ')
}

export function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return 'CC'
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
