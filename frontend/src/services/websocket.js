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
  let generation = 0
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

    const gen = generation + 1
    generation = gen
    setStatus('connecting')
    socket = new WebSocket(url, ['company-chat', token])

    socket.addEventListener('open', () => {
      if (gen !== generation) return
      attempt = 0
      setStatus('open')
      send({ event: 'ping' })
      pingTimer = window.setInterval(() => send({ event: 'ping' }), 25_000)
    })

    socket.addEventListener('message', (message) => {
      if (gen !== generation) return
      try {
        emit(JSON.parse(message.data))
      } catch {
        emit({ event: 'error', data: { code: 'INVALID_FRAME' } })
      }
    })

    socket.addEventListener('close', (event) => {
      if (gen !== generation) return
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
      if (gen !== generation) return
      setStatus('error')
    })
  }

  function disconnect() {
    shouldReconnect = false
    generation += 1
    clearTimers()
    if (socket) {
      socket.close(1000, 'client_disconnect')
      socket = null
    }
    setStatus('idle')
  }

  function reconnect() {
    shouldReconnect = false
    generation += 1
    clearTimers()
    if (socket) {
      socket.close(1000, 'token_refresh')
      socket = null
    }
    connect()
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

  return { connect, disconnect, reconnect, send, subscribe, subscribeStatus }
}

export const websocketManager = createWebSocketManager()
