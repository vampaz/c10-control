<script setup lang="ts">
import type { RepeatMode } from '@shared/types'
import AppIcon from '@/components/AppIcon.vue'

const props = withDefaults(defineProps<{ repeat: RepeatMode; shuffle: boolean; busy?: boolean }>(), {
  busy: false,
})

const emit = defineEmits<{
  repeat: [mode: RepeatMode]
  shuffle: [enabled: boolean]
}>()

const LABELS: Record<RepeatMode, string> = {
  off: 'Repeat',
  all: 'Repeat all',
  one: 'Repeat one',
}

function cycleRepeat(): void {
  emit('repeat', props.repeat === 'off' ? 'all' : props.repeat === 'all' ? 'one' : 'off')
}

function toggleShuffle(): void {
  emit('shuffle', !props.shuffle)
}
</script>

<template>
  <div class="modes">
    <button
      type="button"
      class="mode"
      :class="{ on: repeat !== 'off' }"
      :aria-pressed="repeat !== 'off'"
      :aria-label="`${LABELS[repeat]}, press to change`"
      :title="LABELS[repeat]"
      :disabled="busy"
      @click="cycleRepeat"
    >
      <AppIcon :name="repeat === 'one' ? 'repeatOne' : 'repeat'" :size="17" />
      <span>{{ LABELS[repeat] }}</span>
    </button>

    <button
      type="button"
      class="mode"
      :class="{ on: shuffle }"
      :aria-pressed="shuffle"
      aria-label="Shuffle"
      title="Shuffle"
      :disabled="busy"
      @click="toggleShuffle"
    >
      <AppIcon name="shuffle" :size="17" />
      <span>Shuffle</span>
    </button>
  </div>
</template>

<style scoped>
.modes {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.mode {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: none;
  color: var(--ink-faint);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}

.mode:hover:not(:disabled) {
  color: var(--ink);
  border-color: var(--line-strong);
}

.mode.on {
  border-color: var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
}

.mode:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
