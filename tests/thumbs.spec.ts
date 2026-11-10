import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { thumbnail } from '../server/thumbs.ts'
import type { CoverArt } from '../server/artwork.ts'

async function sourceImage(width = 500, height = 300): Promise<CoverArt> {
  const data = await sharp({
    create: { width, height, channels: 3, background: '#336699' },
  }).jpeg().toBuffer()
  return { data, mime: 'image/jpeg' }
}

describe('thumbnail', () => {
  it('resizes to a square WebP', async () => {
    const result = await thumbnail(await sourceImage(), 320)

    expect(result.mime).toBe('image/webp')
    const meta = await sharp(result.data).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(320)
    expect(meta.height).toBe(320)
    expect(result.data.length).toBeLessThan((await sourceImage()).data.length)
  })

  it('drops a larger cover to the requested width', async () => {
    const result = await thumbnail(await sourceImage(1000, 1000), 96)

    const meta = await sharp(result.data).metadata()
    expect(meta.width).toBe(96)
    expect(meta.height).toBe(96)
  })
})
