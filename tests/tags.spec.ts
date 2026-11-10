import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readTrackTags } from '../server/tags.ts'

const directories: string[] = []

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'c10-tags-'))
  directories.push(path)
  return path
}

function uint32(value: number): Buffer {
  return Buffer.from([(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff])
}

function syncSafe(value: number): Buffer {
  return Buffer.from([(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f])
}

function uint32le(value: number): Buffer {
  return Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff])
}

function flacFile(path: string, comments: string[]): void {
  const vendor = Buffer.from('test')
  const parts: Buffer[] = [uint32le(vendor.length), vendor, uint32le(comments.length)]
  for (const comment of comments) {
    const value = Buffer.from(comment)
    parts.push(uint32le(value.length), value)
  }
  const body = Buffer.concat(parts)
  const size = body.length
  writeFileSync(path, Buffer.concat([
    Buffer.from('fLaC'),
    Buffer.from([0x80 | 4, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff]),
    body,
  ]))
}

function id3Frame(id: string, text: string): Buffer {
  const value = Buffer.concat([Buffer.from([0]), Buffer.from(text, 'latin1')])
  return Buffer.concat([Buffer.from(id), uint32(value.length), Buffer.from([0, 0]), value])
}

function mp3File(path: string, frames: { id: string; text: string }[]): void {
  const body = Buffer.concat(frames.map((frame) => id3Frame(frame.id, frame.text)))
  writeFileSync(path, Buffer.concat([Buffer.from('ID3\x03\x00\x00'), syncSafe(body.length), body]))
}

function mp4Item(name: Buffer, payload: Buffer): Buffer {
  const data = Buffer.concat([uint32(16 + payload.length), Buffer.from('data'), uint32(0), uint32(0), payload])
  return Buffer.concat([uint32(8 + name.length + data.length), name, data])
}

function m4aFile(path: string): void {
  writeFileSync(path, Buffer.concat([
    uint32(8), Buffer.from('ftyp'),
    mp4Item(Buffer.from([0xa9, 0x6e, 0x61, 0x6d]), Buffer.from('Tag Title')),
    mp4Item(Buffer.from([0xa9, 0x41, 0x52, 0x54]), Buffer.from('Tag Artist')),
    mp4Item(Buffer.from([0xa9, 0x61, 0x6c, 0x62]), Buffer.from('Tag Album')),
    mp4Item(Buffer.from('aART'), Buffer.from('Album Artist')),
    mp4Item(Buffer.from('trkn'), Buffer.from([0, 0, 0, 5, 0, 10, 0, 0])),
  ]))
}

afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe('readTrackTags', () => {
  it('reads Vorbis comments from a FLAC file', async () => {
    const file = join(directory(), 'track.flac')
    flacFile(file, ['TITLE=Tag Title', 'ARTIST=Tag Artist', 'ALBUM=Tag Album', 'ALBUMARTIST=Album Artist', 'TRACKNUMBER=5/10'])

    expect(await readTrackTags(file)).toEqual({
      title: 'Tag Title',
      artist: 'Tag Artist',
      album: 'Tag Album',
      albumArtist: 'Album Artist',
      track: 5,
    })
  })

  it('reads ID3 text frames from an MP3 file', async () => {
    const file = join(directory(), 'track.mp3')
    mp3File(file, [
      { id: 'TIT2', text: 'Tag Title' },
      { id: 'TPE1', text: 'Tag Artist' },
      { id: 'TALB', text: 'Tag Album' },
      { id: 'TRCK', text: '7' },
    ])

    expect(await readTrackTags(file)).toEqual({
      title: 'Tag Title',
      artist: 'Tag Artist',
      album: 'Tag Album',
      track: 7,
    })
  })

  it('reads ilst atoms from an M4A file', async () => {
    const file = join(directory(), 'track.m4a')
    m4aFile(file)

    expect(await readTrackTags(file)).toEqual({
      title: 'Tag Title',
      artist: 'Tag Artist',
      album: 'Tag Album',
      albumArtist: 'Album Artist',
      track: 5,
    })
  })

  it('returns nothing for unknown or empty files', async () => {
    const file = join(directory(), 'track.ogg')
    writeFileSync(file, 'not a tag container')

    expect(await readTrackTags(file)).toEqual({})
  })
})
