import { open, readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

export interface CoverArt {
  data: Buffer
  mime: string
}

/** Cover art is looked up in the head of the file; album art sits in the tags. */
const HEAD_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const COVER_STEMS = ['cover', 'folder', 'front', 'album', 'artwork']

/**
 * Finds cover art for one audio file: the picture embedded in its tags first,
 * then an image that sits next to it in the album folder.
 */
export async function readCoverArt(file: string): Promise<CoverArt | null> {
  const embedded = await embeddedCover(file).catch(() => null)
  if (embedded) {
    return embedded
  }
  return folderCover(dirname(file)).catch(() => null)
}

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    const length = Math.min(bytes, info.size)
    const buffer = Buffer.alloc(length)
    if (length > 0) {
      await handle.read(buffer, 0, length, 0)
    }
    return buffer
  } finally {
    await handle.close()
  }
}

async function embeddedCover(file: string): Promise<CoverArt | null> {
  switch (extname(file).toLowerCase()) {
    case '.flac':
      return fromFlac(await readHead(file, HEAD_BYTES))
    case '.mp3':
      return fromId3(await readHead(file, HEAD_BYTES))
    case '.m4a':
    case '.mp4':
    case '.aac':
    case '.alac':
      return fromMp4(await readHead(file, HEAD_BYTES))
    default:
      return null
  }
}

function sniffMime(data: Buffer): string | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) {
    return 'image/jpeg'
  }
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image/png'
  }
  if (data.length > 12
    && data.subarray(0, 4).toString('latin1') === 'RIFF'
    && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp'
  }
  return null
}

/** Sniffs the real format and only trusts the tag when the bytes are unknown. */
function coverOf(data: Buffer, declared = ''): CoverArt | null {
  if (data.length < 4) {
    return null
  }
  const mime = sniffMime(data) ?? (declared.toLowerCase().startsWith('image/') ? declared.toLowerCase() : null)
  return mime ? { data, mime } : null
}

function fromFlac(buffer: Buffer): CoverArt | null {
  if (buffer.length < 8 || buffer.subarray(0, 4).toString('latin1') !== 'fLaC') {
    return null
  }

  let position = 4
  let fallback: CoverArt | null = null
  while (position + 4 <= buffer.length) {
    const header = buffer[position]
    const type = header & 0x7f
    const length = buffer.readUIntBE(position + 1, 3)
    const start = position + 4
    const end = start + length
    if (end > buffer.length) {
      return fallback
    }
    if (type === 6) {
      const picture = parseFlacPicture(buffer.subarray(start, end))
      if (picture?.kind === 3) {
        return picture.art
      }
      fallback ??= picture?.art ?? null
    }
    position = end
    if (header & 0x80) {
      return fallback
    }
  }
  return fallback
}

function parseFlacPicture(block: Buffer): { art: CoverArt; kind: number } | null {
  if (block.length < 32) {
    return null
  }
  const kind = block.readUInt32BE(0)
  const mimeLength = block.readUInt32BE(4)
  const mimeStart = 8
  const mimeEnd = mimeStart + mimeLength
  if (mimeEnd + 4 > block.length) {
    return null
  }
  const mime = block.subarray(mimeStart, mimeEnd).toString('latin1')

  let position = mimeEnd
  const descriptionLength = block.readUInt32BE(position)
  // description, width, height, depth and colours, then the picture length.
  position += 4 + descriptionLength + 16
  if (position + 4 > block.length) {
    return null
  }
  const dataLength = block.readUInt32BE(position)
  const dataStart = position + 4
  const art = coverOf(block.subarray(dataStart, dataStart + dataLength), mime)
  return art ? { art, kind } : null
}

function syncSafe(buffer: Buffer, offset: number): number {
  if (offset + 4 > buffer.length) {
    return 0
  }
  return ((buffer[offset] & 0x7f) << 21)
    | ((buffer[offset + 1] & 0x7f) << 14)
    | ((buffer[offset + 2] & 0x7f) << 7)
    | (buffer[offset + 3] & 0x7f)
}

function fromId3(buffer: Buffer): CoverArt | null {
  if (buffer.length < 10 || buffer.subarray(0, 3).toString('latin1') !== 'ID3') {
    return null
  }

  const version = buffer[3]
  const flags = buffer[5]
  const end = Math.min(buffer.length, 10 + syncSafe(buffer, 6))
  let position = 10
  if (flags & 0x40) {
    // Extended header: its size includes the size field itself in v2.3.
    if (version === 4) {
      position += syncSafe(buffer, position)
    } else {
      position += buffer.readUInt32BE(position) + 4
    }
  }

  let fallback: CoverArt | null = null
  while (position + 10 <= end) {
    const idLength = version === 2 ? 3 : 4
    const id = buffer.subarray(position, position + idLength).toString('latin1')
    if (!/^[A-Z0-9]+$/.test(id)) {
      return fallback
    }

    const headerSize = version === 2 ? 6 : 10
    const frameSize = version === 2
      ? buffer.readUIntBE(position + 3, 3)
      : version === 4
        ? syncSafe(buffer, position + 4)
        : buffer.readUInt32BE(position + 4)
    const start = position + headerSize
    const next = start + frameSize
    if (frameSize <= 0 || next > end) {
      return fallback
    }

    if (id === 'APIC') {
      const picture = parseApic(buffer.subarray(start, next))
      if (picture?.kind === 3) {
        return picture.art
      }
      fallback ??= picture?.art ?? null
    }
    position = next
  }
  return fallback
}

function parseApic(frame: Buffer): { art: CoverArt; kind: number } | null {
  if (frame.length < 4) {
    return null
  }
  const encoding = frame[0]
  const mimeEnd = frame.indexOf(0, 1)
  if (mimeEnd < 0 || mimeEnd + 2 > frame.length) {
    return null
  }
  const mime = frame.subarray(1, mimeEnd).toString('latin1')
  const kind = frame[mimeEnd + 1]

  let position = mimeEnd + 2
  if (encoding === 1 || encoding === 2) {
    while (position + 1 < frame.length && !(frame[position] === 0 && frame[position + 1] === 0)) {
      position += 2
    }
    position += 2
  } else {
    const descriptionEnd = frame.indexOf(0, position)
    if (descriptionEnd < 0) {
      return null
    }
    position = descriptionEnd + 1
  }

  const art = coverOf(frame.subarray(position), mime)
  return art ? { art, kind } : null
}

function fromMp4(buffer: Buffer): CoverArt | null {
  const marker = buffer.indexOf('covr')
  if (marker < 4) {
    return null
  }

  let position = marker + 4
  while (position + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(position)
    const type = buffer.subarray(position + 4, position + 8).toString('latin1')
    if (size < 8 || position + size > buffer.length) {
      return null
    }
    if (type === 'data') {
      // data atom: size, type, version/flags, locale, then the image bytes.
      const flags = buffer.readUInt32BE(position + 8) & 0xffffff
      const art = coverOf(buffer.subarray(position + 16, position + size), flags === 14 ? 'image/png' : 'image/jpeg')
      if (art) {
        return art
      }
    }
    position += size
  }
  return null
}

async function folderCover(directory: string): Promise<CoverArt | null> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const images = entries
    .filter((entry) => entry.isFile() && IMAGE_MIME[extname(entry.name).toLowerCase()])
    .map((entry) => entry.name)
  const preferred = images.find((name) => COVER_STEMS.includes(basename(name, extname(name)).toLowerCase()))
  const chosen = preferred ?? [...images].sort()[0]
  if (!chosen) {
    return null
  }

  const info = await stat(join(directory, chosen)).catch(() => null)
  if (!info || info.size > MAX_IMAGE_BYTES) {
    return null
  }
  const data = await readFile(join(directory, chosen)).catch(() => null)
  return data ? coverOf(data, IMAGE_MIME[extname(chosen).toLowerCase()]) : null
}
