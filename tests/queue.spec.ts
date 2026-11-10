import { describe, expect, it } from 'vitest'
import { emptySpeakerState, type PlayTarget, type PlaybackState, type SpeakerState } from '../shared/types.ts'
import { QueueController } from '../server/queue.ts'

const FIRST: PlayTarget = {
  url: 'http://192.168.1.135:5173/api/library/file?path=a.mp3',
  title: 'First',
  isLive: false,
}

const SECOND: PlayTarget = { ...FIRST, title: 'Second', url: 'http://192.168.1.135:5173/api/library/file?path=b.mp3' }
const LIVE: PlayTarget = { url: 'http://example.com/live.aac', title: 'Live', isLive: true }

function player() {
  const played: PlayTarget[] = []
  const queue = new QueueController(async (target) => {
    played.push(target)
  })
  return { queue, played }
}

function speaker(overrides: Partial<PlaybackState> = {}): SpeakerState {
  const base = emptySpeakerState()
  return {
    ...base,
    connected: true,
    playback: { ...base.playback, status: 'playing', title: 'First', duration: 10, position: 1, isLive: false, url: FIRST.url, ...overrides },
    updatedAt: Date.now(),
  }
}

describe('QueueController', () => {
  it('adds tracks with stable ids', () => {
    const { queue } = player()
    const snapshot = queue.add(FIRST)

    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]).toMatchObject({ title: 'First', isLive: false })
    expect(snapshot.items[0].id).toMatch(/^[0-9a-f]{12}$/)
  })

  it('rejects a track that is not an http URL', () => {
    const { queue } = player()
    expect(() => queue.add({ url: 'file:///a.mp3' })).toThrow('http or https')
  })

  it('plays the chosen index', async () => {
    const { queue, played } = player()
    queue.add(FIRST)
    queue.add(SECOND)

    expect(await queue.play(1)).toBe(true)
    expect(played.map((target) => target.title)).toEqual(['Second'])
    expect(queue.snapshot().activeIndex).toBe(1)
  })

  it('rejects an index outside the queue', async () => {
    const { queue } = player()
    queue.add(FIRST)

    expect(await queue.play(4)).toBe(false)
    expect(queue.snapshot().activeIndex).toBeNull()
  })

  it('moves forward and backward', async () => {
    const { queue, played } = player()
    queue.add(FIRST)
    queue.add(SECOND)
    await queue.play(0)

    expect(await queue.next()).toBe(true)
    expect(played.map((target) => target.title)).toEqual(['First', 'Second'])

    expect(await queue.previous()).toBe(true)
    expect(played.at(-1)?.title).toBe('First')
  })

  it('stops at the end of the queue', async () => {
    const { queue, played } = player()
    queue.add(FIRST)
    await queue.play(0)

    expect(await queue.next()).toBe(true)
    expect(played).toHaveLength(1)
    expect(queue.snapshot().activeIndex).toBeNull()
  })

  it('replaces the queue and plays the first track', async () => {
    const { queue, played } = player()
    queue.add(LIVE)

    const snapshot = await queue.replace([FIRST, SECOND])

    expect(snapshot.items.map((item) => item.title)).toEqual(['First', 'Second'])
    expect(snapshot.activeIndex).toBe(0)
    expect(played.at(-1)?.title).toBe('First')
  })

  it('can replace the queue at a chosen track', async () => {
    const { queue, played } = player()

    const snapshot = await queue.replace([FIRST, SECOND], 1)

    expect(snapshot.activeIndex).toBe(1)
    expect(played.at(-1)?.title).toBe('Second')
  })

  it('does not handle next when nothing is active', async () => {
    const { queue } = player()
    queue.add(FIRST)

    expect(await queue.next()).toBe(false)
    expect(await queue.previous()).toBe(false)
  })

  it('removes a track and keeps the active index aligned', async () => {
    const { queue } = player()
    const first = queue.add(FIRST).items[0]
    queue.add(SECOND)
    queue.add({ ...FIRST, title: 'Third', url: 'http://example.com/c.mp3' })
    await queue.play(1)

    queue.remove(first.id)
    expect(queue.snapshot().activeIndex).toBe(0)

    queue.clear()
    expect(queue.snapshot()).toEqual({ items: [], activeIndex: null })
  })

  it('advances once when a finite track ends', async () => {
    const { queue, played } = player()
    queue.add(FIRST)
    queue.add(SECOND)
    await queue.play(0)

    await queue.onState(speaker({ position: 5 }))
    await queue.onState(speaker({ status: 'stopped', position: 10 }))
    await queue.onState(speaker({ status: 'stopped', position: 10 }))

    expect(played.map((target) => target.title)).toEqual(['First', 'Second'])
    expect(queue.snapshot().activeIndex).toBe(1)
  })

  it('ignores a stale end state from the previous play of the same track', async () => {
    const { queue, played } = player()
    queue.add(FIRST)
    queue.add(SECOND)
    await queue.play(0)

    await queue.onState(speaker({ status: 'playing', position: 10, duration: 10 }))
    expect(played).toHaveLength(1)

    await queue.onState(speaker({ status: 'playing', position: 1, duration: 10 }))
    await queue.onState(speaker({ status: 'stopped', position: 10, duration: 10 }))

    expect(played.map((target) => target.title)).toEqual(['First', 'Second'])
  })

  it('does not advance on the idle state left from before the track started', async () => {
    const { queue, played } = player()
    queue.add(FIRST)
    queue.add(SECOND)
    await queue.play(0)

    await queue.onState(speaker({ status: 'idle', title: '', position: 0 }))

    expect(played).toHaveLength(1)
  })

  it('never auto-advances a live stream', async () => {
    const { queue, played } = player()
    queue.add(LIVE)
    queue.add(SECOND)
    await queue.play(0)

    await queue.onState(speaker({ status: 'stopped', duration: 0, isLive: true }))

    expect(played).toHaveLength(1)
    expect(queue.snapshot().activeIndex).toBe(0)
  })
})
