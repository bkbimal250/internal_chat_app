import { describe, expect, it } from 'vitest'
import { prepareOutgoingFile } from './media-compress'

describe('prepareOutgoingFile', () => {
  it('does not compress documents and keeps the original file', async () => {
    const file = new File(['%PDF-1.4 test'], 'policy.pdf', { type: 'application/pdf' })
    const result = await prepareOutgoingFile(file, { quality: 'auto' })
    expect(result.compressed).toBe(false)
    expect(result.file).toBe(file)
    expect(result.kind).toBe('file')
  })

  it('sends original when quality is original', async () => {
    const file = new File([new Uint8Array(64)], 'shot.png', { type: 'image/png' })
    const result = await prepareOutgoingFile(file, { quality: 'original' })
    expect(result.compressed).toBe(false)
    expect(result.file).toBe(file)
  })

  it('rejects disallowed types', async () => {
    const file = new File(['MZ'], 'payload.exe', { type: 'application/x-msdownload' })
    await expect(prepareOutgoingFile(file)).rejects.toThrow(/not allowed/)
  })
})
