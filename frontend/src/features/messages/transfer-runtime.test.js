import { describe, expect, it } from 'vitest'
import { fileMatchesMeta, missingPartNumbers, retryDelayMs, runPool } from './transfer-runtime'

describe('transfer runtime', () => {
  it('identifies missing multipart parts for resume', () => {
    expect(missingPartNumbers(4, [{ partNumber: 2 }, { partNumber: 3 }])).toEqual([1, 4])
  })

  it('matches the original file fingerprint after a reload', () => {
    const file = { name: 'clip.mp4', size: 9000, lastModified: 10 }
    expect(fileMatchesMeta(file, { fileName: 'clip.mp4', size: 9000, lastModified: 10 })).toBe(true)
    expect(fileMatchesMeta(file, { fileName: 'clip.mp4', size: 9001, lastModified: 10 })).toBe(false)
  })

  it('runs a bounded worker pool in order of completion slots', async () => {
    const seen = []
    const result = await runPool([1, 2, 3, 4], 2, async (item) => {
      seen.push(item)
      return item * 10
    })
    expect(result).toEqual([10, 20, 30, 40])
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })

  it('uses exponential retry delay with jitter', () => {
    const delay = retryDelayMs(2, 100)
    expect(delay).toBeGreaterThanOrEqual(300)
    expect(delay).toBeLessThan(500)
  })
})
