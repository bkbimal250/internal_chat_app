import { describe, expect, it } from 'vitest'
import {
  addSelectedFiles,
  batchProgress,
  fileIdentity,
  MAX_ATTACHMENT_BATCH,
  messageAttachments,
} from './attachment-batch'

function file(name, { type = 'image/png', size = 12, lastModified = 1 } = {}) {
  const blob = new File([new Uint8Array(size)], name, { type, lastModified })
  return blob
}

describe('attachment batch selection', () => {
  it('accepts a single mixed-type file', () => {
    const { items, errors } = addSelectedFiles([], [file('photo.png')])
    expect(errors).toEqual([])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('image')
  })

  it('accepts 10 mixed files', () => {
    const incoming = [
      file('a.png'),
      file('b.jpg', { type: 'image/jpeg', lastModified: 2 }),
      file('c.mp4', { type: 'video/mp4', lastModified: 3 }),
      file('d.mp3', { type: 'audio/mpeg', lastModified: 4 }),
      file('e.pdf', { type: 'application/pdf', lastModified: 5 }),
      file('f.png', { lastModified: 6 }),
      file('g.png', { lastModified: 7 }),
      file('h.png', { lastModified: 8 }),
      file('i.png', { lastModified: 9 }),
      file('j.txt', { type: 'text/plain', lastModified: 10 }),
    ]
    const { items, errors } = addSelectedFiles([], incoming)
    expect(errors).toEqual([])
    expect(items).toHaveLength(10)
    expect(items.map((item) => item.kind)).toEqual([
      'image',
      'image',
      'video',
      'audio',
      'file',
      'image',
      'image',
      'image',
      'image',
      'file',
    ])
  })

  it('accepts 50 files and rejects the 51st', () => {
    const fifty = Array.from({ length: 50 }, (_, index) => file(`n${index}.png`, { lastModified: index + 1 }))
    const first = addSelectedFiles([], fifty)
    expect(first.errors).toEqual([])
    expect(first.items).toHaveLength(MAX_ATTACHMENT_BATCH)
    const extra = addSelectedFiles(first.items, [file('overflow.png', { lastModified: 99 })])
    expect(extra.items).toHaveLength(50)
    expect(extra.errors[0].code).toBe('BATCH')
  })

  it('detects duplicate selections', () => {
    const one = file('same.png', { lastModified: 7 })
    const first = addSelectedFiles([], [one])
    const again = addSelectedFiles(first.items, [file('same.png', { lastModified: 7 })])
    expect(again.items).toHaveLength(1)
    expect(again.errors[0].code).toBe('DUPLICATE')
    expect(fileIdentity(one)).toBe('same.png|12|7')
  })

  it('rejects invalid types and oversized files', () => {
    const huge = file('big.png')
    Object.defineProperty(huge, 'size', { value: 40 * 1024 * 1024 })
    const bad = new File([new Uint8Array(8)], 'virus.exe', { type: 'application/x-msdownload', lastModified: 3 })
    const { items, errors } = addSelectedFiles([], [huge, bad])
    expect(items).toHaveLength(0)
    expect(errors.map((error) => error.code).sort()).toEqual(['SIZE', 'TYPE'])
  })

  it('tracks batch progress and message attachment order', () => {
    const progress = batchProgress([
      { status: 'uploaded', file: { size: 50 }, progress: 100 },
      { status: 'uploading', file: { size: 50 }, progress: 50 },
    ])
    expect(progress.percent).toBe(75)
    expect(
      messageAttachments({
        attachments: [
          { id: 'a', status: 'available' },
          { id: 'b', status: 'available' },
        ],
      }).map((file) => file.id),
    ).toEqual(['a', 'b'])
  })
})
