import { describe, expect, it } from 'vitest'
import { formatEta, formatSize, mimeFromName, planUpload, specFor, TWO_GIB } from './media-limits'

describe('media limits', () => {
  it('plans single PUT under 8 MB and multipart above it', () => {
    expect(planUpload(1024).mode).toBe('single')
    expect(planUpload(8 * 1024 * 1024 + 1).mode).toBe('multipart')
    expect(planUpload(TWO_GIB).partCount).toBe(256)
  })

  it('maps extensions and rejects executables', () => {
    expect(mimeFromName('voice.m4a')).toBe('audio/mp4')
    expect(mimeFromName('clip.3gp')).toBe('video/3gpp')
    expect(mimeFromName('clip.MOV')).toBe('video/quicktime')
    expect(mimeFromName('pack.zip')).toBe('application/zip')
    expect(specFor({ name: 'virus.exe', type: 'application/x-msdownload' }).spec).toBeUndefined()
    expect(specFor({ name: 'deck.pptx', type: '' }).spec.kind).toBe('file')
    expect(specFor({ name: 'notes.pdf', type: 'application/pdf' }).spec.compressible).toBe(false)
  })

  it('formats sizes and estimates', () => {
    expect(formatSize(2048)).toMatch(/KB/)
    expect(formatSize(TWO_GIB)).toMatch(/GB/)
    expect(formatEta(12)).toBe('12s left')
  })
})
