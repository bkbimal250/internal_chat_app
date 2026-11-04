import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebSocketManager } from '@/services/websocket'
import { applyTokens, clearTokens, getAccessToken } from '@/services/session-tokens'

class FakeWebSocket {
  static instances = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor(url, protocols) {
    this.url = url
    this.protocols = protocols
    this.readyState = FakeWebSocket.CONNECTING
    this.listeners = {}
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type, fn) {
    this.listeners[type] = this.listeners[type] || []
    this.listeners[type].push(fn)
  }

  send() {}

  close(code = 1000) {
    this.readyState = FakeWebSocket.CLOSED
    for (const fn of this.listeners.close || []) fn({ code })
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    for (const fn of this.listeners.open || []) fn()
  }
}

describe('websocket reconnection', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    applyTokens({ accessToken: 'ws-token', csrfToken: 'csrf' })
  })

  afterEach(() => {
    clearTokens()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not open a socket until an access token is restored', () => {
    clearTokens()
    const statuses = []
    const manager = createWebSocketManager({
      url: 'ws://127.0.0.1/api/v1/ws',
      onStatus: (status) => statuses.push(status),
    })
    manager.connect()
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(statuses.at(-1)).toBe('idle')
  })

  it('reuses a connecting socket instead of opening a duplicate', () => {
    const manager = createWebSocketManager({ url: 'ws://127.0.0.1/api/v1/ws' })
    manager.connect()
    manager.connect()
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].protocols).toEqual(['company-chat', 'ws-token'])
    manager.disconnect()
  })

  it('reconnects with the restored access token after a refresh', () => {
    const manager = createWebSocketManager({ url: 'ws://127.0.0.1/api/v1/ws' })
    manager.connect()
    FakeWebSocket.instances[0].open()
    applyTokens({ accessToken: 'next-token', csrfToken: 'csrf' })
    manager.reconnect()
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(FakeWebSocket.instances[1].protocols).toEqual(['company-chat', 'next-token'])
    manager.disconnect()
  })

  it('schedules reconnect after a temporary close without dropping the session', () => {
    vi.useFakeTimers()
    const statuses = []
    const manager = createWebSocketManager({
      url: 'ws://127.0.0.1/api/v1/ws',
      onStatus: (status) => statuses.push(status),
    })
    manager.connect()
    FakeWebSocket.instances[0].open()
    FakeWebSocket.instances[0].close(1006)
    expect(statuses).toContain('reconnecting')
    expect(getAccessToken()).toBe('ws-token')
    vi.advanceTimersByTime(2000)
    expect(FakeWebSocket.instances).toHaveLength(2)
    manager.disconnect()
  })
})
