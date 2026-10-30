import '@testing-library/jest-dom/vitest'

class MemoryStorage {
  constructor() {
    this.store = new Map()
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null
  }
  setItem(key, value) {
    this.store.set(key, String(value))
  }
  removeItem(key) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
}

if (!globalThis.localStorage) {
  globalThis.localStorage = new MemoryStorage()
}

if (!globalThis.WebSocket) {
  globalThis.WebSocket = class {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    constructor() {
      this.readyState = 0
    }
    addEventListener() {}
    close() {}
    send() {}
  }
}
