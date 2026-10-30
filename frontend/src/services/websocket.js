import { appConfig } from '@/config/env'
import { getAccessToken } from '@/services/session-tokens'

export function createWebSocketManager({
  url = appConfig.wsUrl,
  getToken = getAccessToken,
  onStatus,
  onEvent,
} = {}) {
  let socket = null
  let shouldReconnect = false
  let attempt = 0
  let reconnectTimer = null
  let pingTimer = null
  const listeners = new Set()
  const statusListeners = new Set()
  if (onStatus) statusListeners.add(onStatus)

  function setStatus(status) {
    for (const listener of statusListeners) listener(status)
  }

  function emit(event) {
    onEvent?.(event)
    for (const listener of listeners) listener(event)
  }

  function clearTimers() {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (pingTimer) {
      window.clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return
    const delay = Math.min(1000 * 2 ** attempt, 15_000)
    attempt += 1
    setStatus('reconnecting')
    reconnectTimer = window.setTimeout(connect, delay)
  }

  function connect() {
    shouldReconnect = true
    clearTimers()
    const token = getToken()
    if (!token) {
      setStatus('idle')
      return
    }

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    setStatus('connecting')
    socket = new WebSocket(url, ['company-chat', token])

    socket.addEventListener('open', () => {
      attempt = 0
      setStatus('open')
      send({ event: 'ping' })
      pingTimer = window.setInterval(() => send({ event: 'ping' }), 25_000)
    })

    socket.addEventListener('message', (message) => {
      try {
        emit(JSON.parse(message.data))
      } catch {
        emit({ event: 'error', data: { code: 'INVALID_FRAME' } })
      }
    })

    socket.addEventListener('close', (event) => {
      socket = null
      if (pingTimer) {
        window.clearInterval(pingTimer)
        pingTimer = null
      }
      if (event.code === 4001) {
        shouldReconnect = false
        setStatus('unauthorized')
        return
      }
      setStatus('closed')
      scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      setStatus('error')
    })
  }

  function disconnect() {
    shouldReconnect = false
    clearTimers()
    if (socket) {
      socket.close(1000, 'client_disconnect')
      socket = null
    }
    setStatus('idle')
  }

  function send(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(payload))
    return true
  }

  function subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function subscribeStatus(listener) {
    statusListeners.add(listener)
    return () => statusListeners.delete(listener)
  }

  return { connect, disconnect, send, subscribe, subscribeStatus }
}

export const websocketManager = createWebSocketManager()
