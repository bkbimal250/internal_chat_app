export function typingLabel(names = []) {
  const unique = [...new Set((names || []).map((name) => String(name || '').trim()).filter(Boolean))]
  if (!unique.length) return ''
  if (unique.length === 1) return `${unique[0]} is typing...`
  if (unique.length === 2) return `${unique[0]} and ${unique[1]} are typing...`
  return `${unique.length} people are typing...`
}

export function remoteTypingNames(userIds, members, currentUserId) {
  const people = Array.isArray(members) ? members : []
  return [...new Set((userIds || []).filter((id) => id && id !== currentUserId))].map((id) => {
    const member = people.find((person) => person.id === id)
    return member?.displayName || member?.fullName || ''
  })
}
