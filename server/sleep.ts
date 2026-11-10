import type { SleepStatus } from '../shared/types.ts'

export type { SleepStatus }

export interface SleepDependencies {
  getVolume: () => number
  setVolume: (level: number) => Promise<void>
  pause: () => Promise<void>
}

export const MIN_MINUTES = 1
export const MAX_MINUTES = 480
/** The last stretch before pausing, during which the volume falls to zero. */
export const FADE_MS = 20_000
const FADE_STEP_MS = 2_000

function validateMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    throw new Error(`Sleep timer must be between ${MIN_MINUTES} and ${MAX_MINUTES} minutes`)
  }
  return minutes
}

/**
 * App-side sleep timer. It fades the speaker out over the last 20 seconds and
 * pauses, then puts the volume back where it was.
 */
export class SleepTimer {
  private endsAt: number | null = null
  private fadeTimer: ReturnType<typeof setTimeout> | null = null
  private originalVolume = 0
  private fading = false
  private generation = 0
  private readonly deps: SleepDependencies

  constructor(deps: SleepDependencies) {
    this.deps = deps
  }

  status(): SleepStatus {
    return { endsAt: this.endsAt }
  }

  start(minutes: number): SleepStatus {
    const delay = validateMinutes(minutes) * 60_000
    this.cancel()

    this.originalVolume = this.deps.getVolume()
    this.endsAt = Date.now() + delay
    const generation = this.generation
    this.fadeTimer = setTimeout(() => void this.fade(generation), Math.max(0, delay - FADE_MS))
    return this.status()
  }

  cancel(): SleepStatus {
    this.generation += 1
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer)
      this.fadeTimer = null
    }
    const restore = this.fading
    this.fading = false
    this.endsAt = null
    if (restore) {
      void this.deps.setVolume(this.originalVolume).catch(() => undefined)
    }
    return this.status()
  }

  private async fade(generation: number): Promise<void> {
    this.fadeTimer = null
    this.fading = true
    const start = this.originalVolume
    const steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS))

    for (let step = 1; step <= steps; step += 1) {
      if (generation !== this.generation) {
        return
      }
      const level = Math.round(start * (1 - step / steps))
      await this.deps.setVolume(level).catch(() => undefined)
    }

    if (generation !== this.generation) {
      return
    }
    await this.deps.pause().catch(() => undefined)
    await this.deps.setVolume(start).catch(() => undefined)
    this.fading = false
    this.endsAt = null
  }
}
