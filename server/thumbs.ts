import sharp from 'sharp'
import type { CoverArt } from './artwork.ts'

/** Square WebP thumbnail for album cards and the player tile. */
export async function thumbnail(art: CoverArt, width: number): Promise<CoverArt> {
  const data = await sharp(art.data)
    .resize({ width, height: width, fit: 'cover', position: 'centre' })
    .webp({ quality: 78 })
    .toBuffer()
  return { data, mime: 'image/webp' }
}
