import { describe, expect, it } from 'vitest'
import { canonicalAppUrl } from '@/lib/canonical-host'

describe('canonicalAppUrl', () => {
  it('rewrites localhost to 127.0.0.1 so refresh cookies stay first-party', () => {
    expect(
      canonicalAppUrl({
        hostname: 'localhost',
        protocol: 'http:',
        port: '5173',
        pathname: '/settings',
        search: '',
        hash: '',
      }),
    ).toBe('http://127.0.0.1:5173/settings')
  })

  it('leaves 127.0.0.1 unchanged', () => {
    expect(
      canonicalAppUrl({
        hostname: '127.0.0.1',
        protocol: 'http:',
        port: '5173',
        pathname: '/',
        search: '',
        hash: '',
      }),
    ).toBeNull()
  })
})
