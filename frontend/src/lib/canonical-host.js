export function canonicalAppUrl(location = window.location) {
  if (location.hostname !== 'localhost') return null
  const port = location.port ? `:${location.port}` : ''
  return `${location.protocol}//127.0.0.1${port}${location.pathname}${location.search}${location.hash}`
}
