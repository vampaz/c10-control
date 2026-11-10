import { open } from 'node:fs/promises'
import { extname } from 'node:path'

export interface TrackTags {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  track?: number
}

/** Text tags live near the start; 512 KB covers typical embedded art too. */
const HEAD_BYTES = 512 * 1024

export async function readTrackTags(file: string): Promise<TrackTags> {
  switch (extname(file).toLowerCase()) {
    case '.flac':
      return fromFlac(await readHead(file))
    case '.mp3':
      return fromId3(await readHead(file))
    case '.m4a':
    case '.mp4':
    case '.aac':
    case '.alac':
      return fromMp4(await readHead(file))
    default:
      return {}
  }
}

async function readHead(file: string): Promise<Buffer> {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat()
    const length = Math.min(HEAD_BYTES, info.size)
    const buffer = Buffer.alloc(length)
    if (length > 0) {
      await handle.read(buffer, 0, length, 0)
    }
    return buffer
  } finally {
    await handle.close()
  }
}

function clean(value: string): string {
  return value.replaceAll('\u0000', '').trim()
}

function trackNumber(value: string): number | undefined {
  const match = /(\d+)/.exec(value)
  if (!match) {
    return undefined
  }
  const number = Number.parseInt(match[1], 10)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function apply(tags: TrackTags, key: string, value: string): void {
  const text = clean(value)
  if (!text) {
    return
  }
  switch (key.toLowerCase()) {
    case 'title':
      tags.title = text
      break
    case 'artist':
      tags.artist = text
      break
    case 'album':
      tags.album = text
      break
    case 'albumartist':
    case 'album artist':
      tags.albumArtist = text
      break
    case 'track':
    case 'tracknumber':
      tags.track = trackNumber(text) ?? tags.track
      break
  }
}

function fromFlac(buffer: Buffer): TrackTags {
  const tags: TrackTags = {}
  if (buffer.length < 8 || buffer.subarray(0, 4).toString('latin1') !== 'fLaC') {
    return tags
  }

  let position = 4
  while (position + 4 <= buffer.length) {
    const header = buffer[position]
    const type = header & 0x7f
    const size = buffer.readUIntBE(position + 1, 3)
    const start = position + 4
    const end = start + size
    if (end > buffer.length) {
      return tags
    }
    if (type === 4) {
      let offset = start
      if (offset + 4 > end) {
        return tags
      }
      const vendorLength = buffer.readUInt32LE(offset)
      offset += 4 + vendorLength
      if (offset + 4 > end) {
        return tags
      }
      const count = buffer.readUInt32LE(offset)
      offset += 4
      for (let index = 0; index < count && offset + 4 <= end; index += 1) {
        const length = buffer.readUInt32LE(offset)
        offset += 4
        if (offset + length > end) {
          return tags
        }
        const entry = buffer.subarray(offset, offset + length).toString('utf8')
        offset += length
        const separator = entry.indexOf('=')
        if (separator > 0) {
          apply(tags, entry.slice(0, separator), entry.slice(separator + 1))
        }
      }
      return tags
    }
    position = end
    if (header & 0x80) {
      return tags
    }
  }
  return tags
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

function id3Text(frame: Buffer): string {
  if (frame.length < 2) {
    return ''
  }
  const encoding = frame[0]
  const data = frame.subarray(1)
  if (encoding === 0) {
    return data.toString('latin1')
  }
  if (encoding === 3) {
    return data.toString('utf8')
  }
  if (encoding === 1 || encoding === 2) {
    let offset = 0
    let bigEndian = false
    if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
      bigEndian = true
      offset = 2
    } else if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
      offset = 2
    }
    const body = data.subarray(offset)
    if (bigEndian) {
      for (let index = 0; index + 1 < body.length; index += 2) {
        const swap = body[index]
        body[index] = body[index + 1]
        body[index + 1] = swap
      }
    }
    return body.toString('utf16le')
  }
  return ''
}

const ID3_FRAMES: Record<string, string> = {
  TIT2: 'title',
  TPE1: 'artist',
  TALB: 'album',
  TPE2: 'albumartist',
  TRCK: 'track',
}

function fromId3(buffer: Buffer): TrackTags {
  const tags: TrackTags = {}
  if (buffer.length < 10 || buffer.subarray(0, 3).toString('latin1') !== 'ID3') {
    return tags
  }

  const version = buffer[3]
  const flags = buffer[5]
  const end = Math.min(buffer.length, 10 + syncSafe(buffer, 6))
  let position = 10
  if (flags & 0x40) {
    position += version === 4 ? syncSafe(buffer, position) : buffer.readUInt32BE(position) + 4
  }

  while (position + 10 <= end) {
    const idLength = version === 2 ? 3 : 4
    const id = buffer.subarray(position, position + idLength).toString('latin1')
    if (!/^[A-Z0-9]+$/.test(id)) {
      return tags
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
      return tags
    }

    const key = ID3_FRAMES[id]
    if (key) {
      apply(tags, key, id3Text(buffer.subarray(start, next)))
    }
    position = next
  }
  return tags
}

const MP4_ATOMS: { bytes: Buffer; key: string }[] = [
  { bytes: Buffer.from([0xa9, 0x6e, 0x61, 0x6d]), key: 'title' }, // ©nam
  { bytes: Buffer.from([0xa9, 0x41, 0x52, 0x54]), key: 'artist' }, // ©ART
  { bytes: Buffer.from([0xa9, 0x61, 0x6c, 0x62]), key: 'album' }, // ©alb
  { bytes: Buffer.from('aART'), key: 'albumartist' },
]

function mp4Value(buffer: Buffer, marker: number): Buffer | null {
  // marker points at the atom name; the data atom follows it.
  const position = marker + 4
  if (position + 16 > buffer.length) {
    return null
  }
  const size = buffer.readUInt32BE(position)
  if (size < 16 || position + size > buffer.length) {
    return null
  }
  return buffer.subarray(position + 16, position + size)
}

function fromMp4(buffer: Buffer): TrackTags {
  const tags: TrackTags = {}
  for (const atom of MP4_ATOMS) {
    const marker = buffer.indexOf(atom.bytes)
    if (marker < 4) {
      continue
    }
    const value = mp4Value(buffer, marker)
    if (value) {
      apply(tags, atom.key, value.toString('utf8'))
    }
  }

  const trackMarker = buffer.indexOf(Buffer.from('trkn'))
  if (trackMarker >= 4) {
    const value = mp4Value(buffer, trackMarker)
    if (value && value.length >= 4) {
      const number = value.readUInt16BE(2)
      if (number > 0) {
        tags.track = number
      }
    }
  }

  return tags
}
