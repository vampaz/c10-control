<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CommandType, PlaybackStatus } from '@shared/types'
import AppIcon from '@/components/AppIcon.vue'
import { formatTime } from '@/format'

const props = defineProps<{
  status: PlaybackStatus
  position: number
  duration: number
  isLive: boolean
  busy: boolean
}>()

const emit = defineEmits<{ command: [type: CommandType, value?: number] }>()

/** How often the local position advances between the speaker's polls. */
const TICK_MS = 200

const dragging = ref(false)
const draft = ref(0)
const pendingSeek = ref<number | null>(null)
const pendingUntil = ref(0)
const now = ref(Date.now())
/** Last position the speaker reported, and when it did. */
const base = ref({ position: 0, at: Date.now() })
let ticker: ReturnType<typeof setInterval> | null = null

watch(
  () => [props.position, props.status, props.duration] as const,
  ([position, status, duration]) => {
    base.value = { position, at: Date.now() }
    if (status === 'playing' && duration > 0) {
      startTicker()
    } else {
      stopTicker()
    }
  },
  { immediate: true },
)

onBeforeUnmount(stopTicker)

function startTicker(): void {
  if (ticker !== null) {
    return
  }
  now.value = Date.now()
  ticker = setInterval(() => {
    now.value = Date.now()
  }, TICK_MS)
}

function stopTicker(): void {
  if (ticker !== null) {
    clearInterval(ticker)
    ticker = null
  }
}

const playing = computed(() => props.status === 'playing')
const showSeek = computed(() => !props.isLive && props.duration > 0)
const progress = computed(() => {
  if (dragging.value) {
    return draft.value
  }
  if (pendingSeek.value !== null && Date.now() < pendingUntil.value) {
    return pendingSeek.value
  }
  if (!playing.value || props.duration <= 0) {
    return props.position
  }
  // Advance locally so the thumb glides instead of stepping on every poll.
  const elapsed = Math.max(0, (now.value - base.value.at) / 1000)
  return Math.min(props.duration, base.value.position + elapsed)
})
const fill = computed(() => {
  if (!showSeek.value) {
    return 0
  }
  return Math.min(100, Math.max(0, (progress.value / props.duration) * 100))
})

watch(() => props.position, (next) => {
  if (dragging.value) {
    return
  }
  if (pendingSeek.value !== null) {
    // Drop the optimistic position once the speaker reports the seek landed.
    if (Math.abs(next - pendingSeek.value) <= 2) {
      pendingSeek.value = null
    }
    return
  }
  draft.value = next
})

function onSeekInput(event: Event): void {
  dragging.value = true
  pendingSeek.value = null
  draft.value = Number((event.target as HTMLInputElement).value)
}

function onSeekCommit(): void {
  dragging.value = false
  pendingSeek.value = draft.value
  pendingUntil.value = Date.now() + 3000
  emit('command', 'seek', draft.value)
}
</script>

<template>
  <div class="transport">
    <div class="seek" :class="{ waiting: !showSeek }">
      <input
        class="range"
        type="range"
        min="0"
        :max="duration || 1"
        step="0.1"
        :value="showSeek ? progress : 0"
        :style="{ '--fill': `${fill}%` }"
        aria-label="Playback position"
        :disabled="!showSeek"
        @input="onSeekInput"
        @change="onSeekCommit"
      />
      <div class="seek-times">
        <span>{{ showSeek ? formatTime(progress) : '0:00' }}</span>
        <span>{{ showSeek ? formatTime(duration) : '--:--' }}</span>
      </div>
    </div>

    <div class="buttons">
      <button
        type="button"
        class="icon-button"
        aria-label="Previous track"
        :disabled="busy"
        @click="emit('command', 'previous')"
      >
        <AppIcon name="previous" :size="22" />
      </button>

      <button
        type="button"
        class="play-button"
        :aria-label="playing ? 'Pause' : 'Play'"
        :disabled="busy"
        @click="emit('command', 'toggle')"
      >
        <AppIcon :name="playing ? 'pause' : 'play'" :size="26" />
      </button>

      <button
        type="button"
        class="icon-button"
        aria-label="Next track"
        :disabled="busy"
        @click="emit('command', 'next')"
      >
        <AppIcon name="next" :size="22" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.transport {
  display: grid;
  gap: 14px;
}

.seek {
  display: grid;
  gap: 6px;
}

/* While the next track has no duration yet, the track stays but the thumb
   waits with it, so it cannot jump to the end and back. */
.seek.waiting .range::-webkit-slider-thumb {
  opacity: 0;
}

.seek.waiting .range::-moz-range-thumb {
  opacity: 0;
}

.seek-times {
  display: flex;
  justify-content: space-between;
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
}

.buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.play-button {
  width: 60px;
  height: 60px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 0;
  color: var(--on-accent);
  background: var(--accent);
  box-shadow: 0 18px 36px -18px var(--accent-glow);
  transition: transform 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.play-button:hover {
  background: var(--accent-strong);
}

.play-button:active {
  transform: scale(0.96);
}

.play-button:disabled,
.icon-button:disabled {
  cursor: progress;
}
</style>
