function stamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const safe = Number.isNaN(date.getTime()) ? new Date() : date
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
      .formatToParts(safe)
      .map((part) => [part.type, part.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${Number(parts.hour)}.${parts.minute}.${parts.second} ${parts.dayPeriod}`,
  }
}

export function archiveFileName(at = new Date()) {
  const parts = stamp(at)
  return `MiChat Files ${parts.date} at ${parts.time}.zip`
}

export function attachmentDisplayName(file) {
  return file?.displayName || 'File'
}
