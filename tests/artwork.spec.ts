import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readCoverArt } from '../server/artwork.ts'

const directories: string[] = []
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'c10-art-'))
  directories.push(path)
  return path
}

function syncSafe(value: number): Buffer {
  return Buffer.from([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ])
}

function flacFile(path: string, image: Buffer | null): void {
  if (!image) {
    writeFileSync(path, Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0x00, 0x00, 0x22])]))
    return
  }
  const mime = Buffer.from('image/jpeg')
  const block = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x03]),
    Buffer.from([0x00, 0x00, 0x00, mime.length]),
    mime,
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.alloc(16),
    Buffer.from([(image.length >> 24) & 0xff, (image.length >> 16) & 0xff, (image.length >> 8) & 0xff, image.length & 0xff]),
    image,
  ])
  const size = block.length
  writeFileSync(path, Buffer.concat([
    Buffer.from('fLaC'),
    Buffer.from([0x80 | 6, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff]),
    block,
  ]))
}

function mp3File(path: string, image: Buffer | null): void {
  if (!image) {
    writeFileSync(path, Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'))
    return
  }
  const frame = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('image/jpeg'),
    Buffer.from([0x00, 0x03, 0x00]),
    image,
  ])
  const size = Buffer.from([(frame.length >> 24) & 0xff, (frame.length >> 16) & 0xff, (frame.length >> 8) & 0xff, frame.length & 0xff])
  const body = Buffer.concat([Buffer.from('APIC'), size, Buffer.from([0x00, 0x00]), frame])
  writeFileSync(path, Buffer.concat([Buffer.from('ID3\x03\x00\x00'), syncSafe(body.length), body]))
}

function uint32(value: number): Buffer {
  return Buffer.from([(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff])
}

function m4aFile(path: string): void {
  const payload = Buffer.concat([
    uint32(14),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    PNG,
  ])
  const data = Buffer.concat([uint32(8 + payload.length), Buffer.from('data'), payload])
  const covr = Buffer.concat([uint32(8 + data.length), Buffer.from('covr'), data])
  writeFileSync(path, Buffer.concat([uint32(8), Buffer.from('ftyp'), covr]))
}

afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('readCoverArt', () => {
  it('reads the picture block from a FLAC file', async () => {
    const root = directory()
    const file = join(root, 'track.flac')
    flacFile(file, JPEG)

    const art = await readCoverArt(file)

    expect(art?.mime).toBe('image/jpeg')
    expect(art?.data.subarray(0, 2)).toEqual(JPEG.subarray(0, 2))
  })

  it('reads an APIC frame from an MP3 file', async () => {
    const root = directory()
    const file = join(root, 'track.mp3')
    mp3File(file, JPEG)

    const art = await readCoverArt(file)

    expect(art?.mime).toBe('image/jpeg')
    expect(art?.data.subarray(0, 2)).toEqual(JPEG.subarray(0, 2))
  })

  it('reads a covr atom from an M4A file', async () => {
    const root = directory()
    const file = join(root, 'track.m4a')
    m4aFile(file)

    const art = await readCoverArt(file)

    expect(art?.mime).toBe('image/png')
    expect(art?.data.subarray(1, 4).toString('latin1')).toBe('PNG')
  })

  it('falls back to an image in the album folder', async () => {
    const root = directory()
    const file = join(root, 'track.flac')
    flacFile(file, null)
    writeFileSync(join(root, 'zzz.png'), PNG)
    writeFileSync(join(root, 'cover.jpg'), JPEG)

    const art = await readCoverArt(file)

    expect(art?.mime).toBe('image/jpeg')
  })

  it('prefers embedded art over the folder image', async () => {
    const root = directory()
    const file = join(root, 'track.mp3')
    mp3File(file, JPEG)
    writeFileSync(join(root, 'cover.png'), PNG)

    const art = await readCoverArt(file)

    expect(art?.mime).toBe('image/jpeg')
  })

  it('returns null when nothing has art', async () => {
    const root = directory()
    const file = join(root, 'track.flac')
    flacFile(file, null)

    expect(await readCoverArt(file)).toBeNull()
  })
})
