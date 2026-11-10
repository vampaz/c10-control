import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySpeakerState, type PlayTarget, type PlaybackState, type SpeakerState } from '../shared/types.ts'
import { QueueController } from '../server/queue.ts'

const FIRST: PlayTarget = {
  url: 'http://192.168.1.135:5173/api/library/file?path=a.mp3',
  title: 'First',
  isLive: false,
}

const SECOND: PlayTarget = { ...FIRST, title: 'Second', url: 'http://192.168.1.135:5173/api/library/file?path=b.mp3' }
const THIRD: PlayTarget = { ...FIRST, title: 'Third', url: 'http://192.168.1.135:5173/api/library/file?path=c.mp3' }
const FOURTH: PlayTarget = { ...FIRST, title: 'Fourth', url: 'http://192.168.1.135:5173/api/library/file?path=d.mp3' }
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

  it('leaves the last track active for an explicit next', async () => {
    const { queue, played } = player()
    queue.add(FIRST)
    await queue.play(0)

    expect(await queue.next()).toBe(false)
    expect(played).toHaveLength(1)
    expect(queue.snapshot().activeIndex).toBe(0)
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

  it('reports repeat and shuffle, and keeps them across a replace', async () => {
    const { queue } = player()

    expect(queue.snapshot()).toMatchObject({ repeat: 'off', shuffle: false })
    expect(queue.setMode({ repeat: 'all', shuffle: true })).toMatchObject({ repeat: 'all', shuffle: true })

    const snapshot = await queue.replace([FIRST, SECOND])

    expect(snapshot).toMatchObject({ repeat: 'all', shuffle: true })
  })

  it('wraps to the first track when repeat is all', async () => {
    const { queue, played } = player()
    await queue.replace([FIRST, SECOND])
    queue.setMode({ repeat: 'all' })

    await queue.next()
    await queue.next()

    expect(queue.snapshot().activeIndex).toBe(0)
    expect(played.at(-1)?.title).toBe('First')
  })

  it('repeats the current track only on automatic advance', async () => {
    const { queue, played } = player()
    await queue.replace([FIRST, SECOND])
    queue.setMode({ repeat: 'one' })

    await queue.next(true)
    expect(queue.snapshot().activeIndex).toBe(0)
    expect(played.at(-1)?.title).toBe('First')

    await queue.next()
    expect(queue.snapshot().activeIndex).toBe(1)
    expect(played.at(-1)?.title).toBe('Second')
  })

  it('plays every track once in shuffle order', async () => {
    const { queue } = player()
    await queue.replace([FIRST, SECOND, THIRD, FOURTH], 0)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)

    queue.setMode({ shuffle: true })
    const visited = [queue.snapshot().activeIndex]
    for (let step = 0; step < 3; step += 1) {
      await queue.next()
      visited.push(queue.snapshot().activeIndex)
    }
    random.mockRestore()

    expect(visited[0]).toBe(0)
    expect(new Set(visited).size).toBe(4)
  })

  it('leaves the last track active for an explicit next but ends it automatically', async () => {
    const { queue, played } = player()
    await queue.replace([FIRST, SECOND])
    await queue.next()

    expect(await queue.next()).toBe(false)
    expect(queue.snapshot().activeIndex).toBe(1)
    expect(played).toHaveLength(2)

    expect(await queue.next(true)).toBe(true)
    expect(queue.snapshot().activeIndex).toBeNull()
  })

  it('restarts the first track on previous, and wraps with repeat all', async () => {    const { queue, played } = player()
    await queue.replace([FIRST, SECOND])

    await queue.previous()
    expect(played.at(-1)?.title).toBe('First')

    queue.setMode({ repeat: 'all' })
    await queue.previous()
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
    expect(queue.snapshot()).toEqual({ items: [], activeIndex: null, repeat: 'off', shuffle: false })
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

describe('QueueController persistence', () => {
  it('restores the queue, active track and mode from disk', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'c10-queue-'))
    const store = join(directory, 'queue.json')

    try {
      const first = new QueueController(async () => undefined, store)
      await first.replace([FIRST, SECOND])
      first.setMode({ repeat: 'one' })

      const restored = new QueueController(async () => undefined, store)

      expect(restored.snapshot()).toMatchObject({ repeat: 'one', shuffle: false, activeIndex: 0 })
      expect(restored.snapshot().items.map((item) => item.title)).toEqual(['First', 'Second'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('starts empty when the file cannot be read', () => {
    const directory = mkdtempSync(join(tmpdir(), 'c10-queue-'))

    try {
      const queue = new QueueController(async () => undefined, join(directory, 'missing.json'))
      expect(queue.snapshot().items).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
