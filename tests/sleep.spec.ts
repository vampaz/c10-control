import { afterEach, describe, expect, it, vi } from 'vitest'
import { FADE_MS, SleepTimer } from '../server/sleep.ts'

function setup(volume = 40) {
  const volumes: number[] = []
  const pause = vi.fn(async () => undefined)
  const timer = new SleepTimer({
    getVolume: () => volume,
    setVolume: async (level) => {
      volumes.push(level)
    },
    pause,
  })
  return { timer, volumes, pause }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SleepTimer', () => {
  it('reports the deadline after starting', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    const { timer } = setup()

    const status = timer.start(30)

    expect(status.endsAt).toBe(Date.now() + 30 * 60_000)
  })

  it('rejects a duration outside the allowed range', () => {
    const { timer } = setup()
    expect(() => timer.start(0)).toThrow('Sleep timer')
    expect(() => timer.start(481)).toThrow('Sleep timer')
  })

  it('cancels before the fade and leaves the volume alone', async () => {
    vi.useFakeTimers()
    const { timer, volumes, pause } = setup()

    timer.start(1)
    expect(timer.cancel().endsAt).toBeNull()
    await vi.advanceTimersByTimeAsync(61_000)

    expect(volumes).toEqual([])
    expect(pause).not.toHaveBeenCalled()
  })

  it('fades to zero, pauses, then restores the volume', async () => {
    vi.useFakeTimers()
    const { timer, volumes, pause } = setup(40)

    timer.start(1)
    await vi.advanceTimersByTimeAsync(60_000 + FADE_MS)

    expect(volumes.length).toBeGreaterThan(0)
    expect(volumes).toContain(0)
    expect(pause).toHaveBeenCalledOnce()
    expect(volumes.at(-1)).toBe(40)
    expect(timer.status().endsAt).toBeNull()
  })

  it('restarts cleanly when started twice', () => {
    vi.useFakeTimers()
    const { timer } = setup()

    timer.start(10)
    const second = timer.start(20)

    expect(second.endsAt).toBe(Date.now() + 20 * 60_000)
  })
})
