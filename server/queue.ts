import { createHash } from 'node:crypto'
import type { PlayTarget, QueueItem, QueueSnapshot, SpeakerState } from '../shared/types.ts'
import { validateTarget } from './presets.ts'

let sequence = 0

function itemId(url: string): string {
  sequence += 1
  return createHash('sha1').update(`${url}|${Date.now()}|${sequence}`).digest('hex').slice(0, 12)
}

/**
 * App-side play queue. The speaker only knows the current URI, so the list and
 * the auto-advance live here.
 */
export class QueueController {
  private items: QueueItem[] = []
  private activeIndex: number | null = null
  private started = false
  private startedAt = 0
  private advancing = false
  private readonly playTarget: (target: PlayTarget) => Promise<void>

  constructor(playTarget: (target: PlayTarget) => Promise<void>) {
    this.playTarget = playTarget
  }

  snapshot(): QueueSnapshot {
    return { items: this.items, activeIndex: this.activeIndex }
  }

  add(input: PlayTarget): QueueSnapshot {
    const target = validateTarget(input)
    this.items.push({ ...target, id: itemId(target.url) })
    return this.snapshot()
  }

  remove(id: string): QueueSnapshot {
    const index = this.items.findIndex((item) => item.id === id)
    if (index === -1) {
      return this.snapshot()
    }

    this.items.splice(index, 1)
    if (this.activeIndex !== null) {
      if (index === this.activeIndex) {
        this.activeIndex = null
      } else if (index < this.activeIndex) {
        this.activeIndex -= 1
      }
    }
    return this.snapshot()
  }

  clear(): QueueSnapshot {
    this.items = []
    this.activeIndex = null
    this.started = false
    this.startedAt = 0
    return this.snapshot()
  }

  /** Replaces the queue and starts the first track. */
  async replace(targets: PlayTarget[]): Promise<QueueSnapshot> {
    this.items = targets.map((target) => ({ ...validateTarget(target), id: itemId(target.url) }))
    this.activeIndex = null
    this.started = false
    this.startedAt = 0
    if (this.items.length) {
      await this.play(0)
    }
    return this.snapshot()
  }

  async play(index = 0): Promise<boolean> {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) {
      return false
    }

    this.activeIndex = index
    this.started = false
    this.startedAt = Date.now()
    this.advancing = false
    await this.playTarget(this.items[index])
    return true
  }

  /** Returns true when the queue handled the request. */
  async next(): Promise<boolean> {
    if (this.activeIndex === null) {
      return false
    }
    const next = this.activeIndex + 1
    if (next >= this.items.length) {
      this.activeIndex = null
      return true
    }
    return this.play(next)
  }

  async previous(): Promise<boolean> {
    if (this.activeIndex === null) {
      return false
    }
    return this.play(Math.max(0, this.activeIndex - 1))
  }

  /**
   * Advances once when a finite track ends. A track only counts as ended after
   * it was seen playing, so the idle state left over from the previous track
   * cannot skip an item.
   */
  async onState(state: SpeakerState): Promise<void> {
    if (this.activeIndex === null || this.advancing) {
      return
    }

    const item = this.items[this.activeIndex]
    if (!item || item.isLive !== false) {
      return
    }

    // Ignore a state that was polled before this track was requested.
    if (state.updatedAt < this.startedAt) {
      return
    }

    // The poller can still report the previous track right after a switch.
    const current = state.playback.url === item.url
      || (!state.playback.url && Boolean(item.title) && state.playback.title === item.title)
    if (!current) {
      return
    }

    const { status, duration, position } = state.playback
    const atEnd = duration > 0 && position >= duration - 1
    // Only a state seen before the end proves this track actually started.
    if (status === 'playing' && !atEnd) {
      this.started = true
    }
    if (!this.started) {
      return
    }

    const ended = status === 'stopped' || status === 'idle' || atEnd
    if (!ended) {
      return
    }

    this.advancing = true
    try {
      await this.next()
    } catch {
      this.activeIndex = null
    } finally {
      this.advancing = false
    }
  }
}
