import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
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
  private readonly storePath: string | null

  constructor(playTarget: (target: PlayTarget) => Promise<void>, storePath: string | null = null) {
    this.playTarget = playTarget
    this.storePath = storePath
    this.restore()
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
    let changed = false
    if (patch.repeat && patch.repeat !== this.repeat) {
      this.repeat = patch.repeat
      changed = true
    }
    if (typeof patch.shuffle === 'boolean' && patch.shuffle !== this.shuffle) {
      this.shuffle = patch.shuffle
      this.buildOrder()
      changed = true
    }
    if (changed) {
      this.persist()
    }
    return this.snapshot()
  }

  add(input: PlayTarget): QueueSnapshot {
    const target = validateTarget(input)
    this.items.push({ ...target, id: itemId(target.url) })
    this.order.push(this.items.length - 1)
    this.persist()
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
    this.persist()
    return this.snapshot()
  }

  clear(): QueueSnapshot {
    this.items = []
    this.order = []
    this.activeIndex = null
    this.started = false
    this.startedAt = 0
    this.persist()
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
      this.persist()
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
    this.persist()
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
      // Auto-advance runs after the track ended; an explicit next must not
      // clear the active item while the speaker is still playing it.
      if (automatic) {
        this.activeIndex = null
        this.persist()
        return true
      }
      return false
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

  /** Restores the queue written by the previous process. */
  private restore(): void {
    if (!this.storePath) {
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.storePath, 'utf8')) as {
        items?: unknown
        activeIndex?: unknown
        repeat?: unknown
        shuffle?: unknown
      }
      if (!Array.isArray(raw.items)) {
        return
      }

      const items: QueueItem[] = []
      for (const entry of raw.items) {
        try {
          const target = validateTarget(entry as PlayTarget)
          const id = typeof (entry as { id?: unknown }).id === 'string'
            ? String((entry as { id: string }).id)
            : itemId(target.url)
          items.push({ ...target, id })
        } catch {
          // Skip entries that are no longer valid.
        }
      }

      this.items = items
      this.repeat = raw.repeat === 'all' || raw.repeat === 'one' ? raw.repeat : 'off'
      this.shuffle = raw.shuffle === true
      const active = raw.activeIndex
      this.activeIndex = typeof active === 'number' && Number.isInteger(active) && active >= 0 && active < items.length
        ? active
        : null
      this.buildOrder()
    } catch {
      // A missing or unreadable file starts with an empty queue.
    }
  }

  /** Persists the queue; a failed write must not break playback. */
  private persist(): void {
    if (!this.storePath) {
      return
    }
    try {
      mkdirSync(dirname(this.storePath), { recursive: true })
      const temporary = `${this.storePath}.tmp`
      writeFileSync(temporary, `${JSON.stringify({
        items: this.items,
        activeIndex: this.activeIndex,
        repeat: this.repeat,
        shuffle: this.shuffle,
      }, null, 2)}\n`, 'utf8')
      renameSync(temporary, this.storePath)
    } catch {
      // Best effort only.
    }
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
