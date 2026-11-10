import { createHash } from 'node:crypto'
import type { PlayTarget, QueueItem, QueueSnapshot, RepeatMode, SpeakerState } from '../shared/types.ts'
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
  private repeat: RepeatMode = 'off'
  private shuffle = false
  /** Positions of `items` in play order; identity until shuffle is enabled. */
  private order: number[] = []
  private started = false
  private startedAt = 0
  private advancing = false
  private readonly playTarget: (target: PlayTarget) => Promise<void>

  constructor(playTarget: (target: PlayTarget) => Promise<void>) {
    this.playTarget = playTarget
  }

  snapshot(): QueueSnapshot {
    return {
      items: this.items,
      activeIndex: this.activeIndex,
      repeat: this.repeat,
      shuffle: this.shuffle,
    }
  }

  /** Changes repeat and shuffle; both survive queue replacement. */
  setMode(patch: { repeat?: RepeatMode; shuffle?: boolean }): QueueSnapshot {
    if (patch.repeat && patch.repeat !== this.repeat) {
      this.repeat = patch.repeat
    }
    if (typeof patch.shuffle === 'boolean' && patch.shuffle !== this.shuffle) {
      this.shuffle = patch.shuffle
      this.buildOrder()
    }
    return this.snapshot()
  }

  add(input: PlayTarget): QueueSnapshot {
    const target = validateTarget(input)
    this.items.push({ ...target, id: itemId(target.url) })
    this.order.push(this.items.length - 1)
    return this.snapshot()
  }

  remove(id: string): QueueSnapshot {
    const index = this.items.findIndex((item) => item.id === id)
    if (index === -1) {
      return this.snapshot()
    }

    this.items.splice(index, 1)
    this.order = this.order
      .filter((position) => position !== index)
      .map((position) => (position > index ? position - 1 : position))
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
    this.order = []
    this.activeIndex = null
    this.started = false
    this.startedAt = 0
    return this.snapshot()
  }

  /** Replaces the queue and starts playback, by default at the first track. */
  async replace(targets: PlayTarget[], startIndex = 0): Promise<QueueSnapshot> {
    this.items = targets.map((target) => ({ ...validateTarget(target), id: itemId(target.url) }))
    this.activeIndex = null
    this.started = false
    this.startedAt = 0
    if (this.items.length) {
      const index = Number.isInteger(startIndex) ? startIndex : 0
      const chosen = Math.min(Math.max(0, index), this.items.length - 1)
      this.buildOrder(chosen)
      await this.play(chosen)
    } else {
      this.order = []
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

  /**
   * Advances in play order. Auto-advance repeats the current track when repeat
   * is "one", while an explicit next always moves on.
   */
  async next(automatic = false): Promise<boolean> {
    if (this.activeIndex === null) {
      return false
    }
    if (automatic && this.repeat === 'one') {
      return this.play(this.activeIndex)
    }

    const order = this.playOrder()
    const position = order.indexOf(this.activeIndex)
    const next = position === -1 ? undefined : order[position + 1]
    if (next === undefined) {
      if (this.repeat === 'all' && order.length) {
        return this.play(order[0])
      }
      this.activeIndex = null
      return true
    }
    return this.play(next)
  }

  async previous(): Promise<boolean> {
    if (this.activeIndex === null) {
      return false
    }

    const order = this.playOrder()
    const position = order.indexOf(this.activeIndex)
    if (position > 0) {
      return this.play(order[position - 1])
    }
    if (this.repeat === 'all' && order.length) {
      return this.play(order[order.length - 1])
    }
    return this.play(this.activeIndex)
  }

  private playOrder(): number[] {
    return this.order.length ? this.order : this.items.map((_, index) => index)
  }

  /** Rebuilds the play order, keeping `first` at the front when given. */
  private buildOrder(first: number | null = this.activeIndex): void {
    const indices = this.items.map((_, index) => index)
    if (!this.shuffle) {
      this.order = indices
      return
    }

    const rest = indices.filter((index) => index !== first)
    for (let position = rest.length - 1; position > 0; position -= 1) {
      const random = Math.floor(Math.random() * (position + 1))
      const swap = rest[position]
      rest[position] = rest[random]
      rest[random] = swap
    }
    this.order = first === null ? rest : [first, ...rest]
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
      await this.next(true)
    } catch {
      this.activeIndex = null
    } finally {
      this.advancing = false
    }
  }
}
