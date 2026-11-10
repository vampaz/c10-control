import { describe, expect, it } from 'vitest'
import { buildQueueContext, parseQueueContext, SPEAKER_QUEUE_NAME } from '../server/playqueue.ts'

const TARGET = {
  url: 'http://host/api/library/file?library=main&path=a.mp3',
  title: 'A & B',
  isLive: false,
}

describe('speaker play queue', () => {
  it('builds a PlayList document with escaped metadata', () => {
    const xml = buildQueueContext(SPEAKER_QUEUE_NAME, [TARGET])

    expect(xml).toContain('<ListName>C10Control</ListName>')
    expect(xml).toContain('<TrackNumber>1</TrackNumber>')
    expect(xml).toContain('<URL>http://host/api/library/file?library=main&amp;path=a.mp3</URL>')
    expect(xml).toContain('A &amp;amp; B')
  })

  it('parses a queue document back into tracks', () => {
    const xml = buildQueueContext('Test', [
      TARGET,
      { ...TARGET, url: 'http://host/b.mp3', title: 'B' },
    ])

    const tracks = parseQueueContext(xml)

    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toEqual({ title: 'A & B', url: TARGET.url })
    expect(tracks[1].url).toBe('http://host/b.mp3')
  })
})
