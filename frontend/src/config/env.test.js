import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl, resolveWsUrl } from '@/config/env'

describe('API origin', () => {
  it('uses the local API during development when unset', () => {
    expect(resolveApiBaseUrl({ viteApiBaseUrl: '', isProd: false })).toBe('http://127.0.0.1:3001')
  })

  it('uses same-origin in production when unset', () => {
    expect(resolveApiBaseUrl({ viteApiBaseUrl: '', isProd: true })).toBe('')
  })

  it('honors an explicit origin and strips a trailing slash', () => {
    expect(resolveApiBaseUrl({ viteApiBaseUrl: 'https://chat.example.com/', isProd: true })).toBe(
      'https://chat.example.com',
    )
  })

  it('builds wss from a same-origin HTTPS page', () => {
    expect(resolveWsUrl('', { protocol: 'https:', host: 'chat.example.com' })).toBe(
      'wss://chat.example.com/api/v1/ws',
    )
  })

  it('derives ws from an explicit HTTP API origin', () => {
    expect(resolveWsUrl('http://127.0.0.1:3001')).toBe('ws://127.0.0.1:3001/api/v1/ws')
  })

  it('uses the production API origin and derives wss', () => {
    expect(resolveApiBaseUrl({ viteApiBaseUrl: 'https://api.michat.in/', isProd: true })).toBe(
      'https://api.michat.in',
    )
    expect(resolveWsUrl('https://api.michat.in')).toBe('wss://api.michat.in/api/v1/ws')
  })
})
