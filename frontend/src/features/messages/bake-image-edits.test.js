import { describe, expect, it } from 'vitest'
import { bakeComposerItems, bakeImageEdits, hasImageEdits } from './bake-image-edits'

describe('image edit baking', () => {
  it('detects rotate and brightness changes', () => {
    expect(hasImageEdits()).toBe(false)
    expect(hasImageEdits({ rotation: 0, brightness: 1 })).toBe(false)
    expect(hasImageEdits({ rotation: 90, brightness: 1 })).toBe(true)
    expect(hasImageEdits({ rotation: 0, brightness: 1.25 })).toBe(true)
  })

  it('returns the original file when there are no edits', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
    await expect(bakeImageEdits(file)).resolves.toBe(file)
    await expect(bakeImageEdits(file, { rotation: 0, brightness: 1 })).resolves.toBe(file)
  })

  it('keeps composer order and skips items that were not edited', async () => {
    const items = [
      { id: 'a', kind: 'image', file: new File([new Uint8Array([1])], 'one.png', { type: 'image/png' }) },
      { id: 'b', kind: 'video', file: new File([new Uint8Array([2])], 'two.mp4', { type: 'video/mp4' }) },
      { id: 'c', kind: 'image', file: new File([new Uint8Array([3])], 'three.png', { type: 'image/png' }) },
    ]
    const baked = await bakeComposerItems(items, { a: { rotation: 0, brightness: 1 } })
    expect(baked.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(baked[0].file).toBe(items[0].file)
    expect(baked[1].file).toBe(items[1].file)
  })
})
