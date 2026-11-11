<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { cancelSleep, getSleep, startSleep } from '@/api'
import { formatTime } from '@/format'

type Mode = 'loading' | 'idle' | 'menu' | 'active' | 'busy'

const DURATIONS = [15, 30, 45, 60]

const mode = ref<Mode>('loading')
const endsAt = ref<number | null>(null)
const now = ref(Date.now())
const error = ref<string | null>(null)

let ticker: ReturnType<typeof setInterval> | null = null

const remaining = computed(() => Math.max(0, (endsAt.value ?? 0) - now.value))
const remainingLabel = computed(() => formatTime(Math.ceil(remaining.value / 1000)))

onMounted(async () => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  try {
    const status = await getSleep()
    apply(status.endsAt)
  } catch {
    mode.value = 'idle'
  }
})

onBeforeUnmount(() => {
  stopTicker()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

function apply(next: number | null): void {
  endsAt.value = next
  if (next && next > Date.now()) {
    mode.value = 'active'
    startTicker()
  } else {
    mode.value = 'idle'
    stopTicker()
  }
}

function startTicker(): void {
  stopTicker()
  now.value = Date.now()
  ticker = setInterval(() => {
    now.value = Date.now()
    if (remaining.value <= 0) {
      apply(null)
    }
  }, 1000)
}

function stopTicker(): void {
  if (ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

function onVisibilityChange(): void {
  if (document.hidden) {
    stopTicker()
    return
  }
  if (mode.value !== 'active') {
    return
  }
  // The interval was paused while hidden: recompute from the stored deadline.
  now.value = Date.now()
  if (remaining.value <= 0) {
    apply(null)
    return
  }
  startTicker()
}

function openMenu(): void {
  if (mode.value === 'idle') {
    mode.value = 'menu'
  } else if (mode.value === 'menu') {
    mode.value = 'idle'
  }
}

async function start(minutes: number): Promise<void> {
  mode.value = 'busy'
  error.value = null
  try {
    const status = await startSleep(minutes)
    apply(status.endsAt)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The sleep timer could not start'
    mode.value = 'idle'
  }
}

async function cancel(): Promise<void> {
  mode.value = 'busy'
  error.value = null
  try {
    await cancelSleep()
    apply(null)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'The sleep timer could not be cancelled'
    mode.value = 'active'
  }
}
</script>

<template>
  <div class="sleep">
    <div v-if="mode === 'active'" class="active">
      <span class="status">Sleep in {{ remainingLabel }}</span>
      <button type="button" class="text-button" @click="cancel">Cancel</button>
    </div>

    <div v-else class="idle">
      <button type="button" class="sleep-button" :disabled="mode === 'loading' || mode === 'busy'" @click="openMenu">
        Sleep
      </button>
      <div v-if="mode === 'menu'" class="menu" role="menu" aria-label="Sleep timer">
        <button
          v-for="minutes in DURATIONS"
          :key="minutes"
          type="button"
          role="menuitem"
          @click="start(minutes)"
        >
          {{ minutes }} min
        </button>
      </div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.sleep {
  display: grid;
  gap: 6px;
}

.idle,
.active {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sleep-button {
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--ink-dim);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}

.sleep-button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--ink);
}

.sleep-button:disabled {
  opacity: 0.45;
  cursor: default;
}

.menu {
  display: flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
}

.menu button {
  padding: 5px 9px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--ink-dim);
  font: inherit;
  font-size: 0.74rem;
  cursor: pointer;
}

.menu button:hover {
  background: var(--surface-hover);
  color: var(--ink);
}

.status {
  font-size: 0.78rem;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
</style>
