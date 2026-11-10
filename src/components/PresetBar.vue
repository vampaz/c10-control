<script setup lang="ts">
import type { PlayTarget } from '@shared/types'
import AppIcon from '@/components/AppIcon.vue'

defineProps<{
  presets: (PlayTarget | null)[]
  current: PlayTarget | null
  busy: boolean
}>()

const emit = defineEmits<{
  play: [target: PlayTarget]
  save: [index: number]
  clear: [index: number]
}>()

function label(target: PlayTarget | null): string {
  if (!target) {
    return ''
  }
  return target.title?.trim() || target.url
}
</script>

<template>
  <div class="presets" role="group" aria-label="Presets">
    <div v-for="(target, index) in presets" :key="index" class="slot">
      <button
        v-if="target"
        type="button"
        class="slot-main"
        :disabled="busy"
        @click="emit('play', target)"
      >
        <span class="slot-index">{{ index + 1 }}</span>
        <span class="slot-title">{{ label(target) }}</span>
        <span class="sr-only">Play preset {{ index + 1 }}</span>
      </button>
      <button
        v-else
        type="button"
        class="slot-main empty"
        :disabled="busy || !current"
        @click="emit('save', index)"
      >
        <span class="slot-index">{{ index + 1 }}</span>
        <span class="slot-title">Set</span>
        <span class="sr-only">Save the current track to preset {{ index + 1 }}</span>
      </button>

      <button
        v-if="target"
        type="button"
        class="slot-clear"
        :disabled="busy"
        :aria-label="`Clear preset ${index + 1}`"
        @click="emit('clear', index)"
      >
        <AppIcon name="close" :size="12" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.presets {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}

.slot {
  position: relative;
  min-width: 0;
}

.slot-main {
  width: 100%;
  display: grid;
  gap: 2px;
  padding: 8px 7px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #17181a;
  color: var(--ink-dim);
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}

.slot-main:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--ink);
}

.slot-main:disabled {
  cursor: default;
  opacity: 0.45;
}

.slot-main.empty .slot-title {
  color: var(--ink-dim);
}

.slot-index {
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
}

.slot-title {
  overflow: hidden;
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slot-clear {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(10, 10, 11, 0.72);
  color: var(--ink-faint);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 140ms ease, color 140ms ease;
}

.slot:hover .slot-clear,
.slot-clear:focus-visible {
  opacity: 1;
}

.slot-clear:hover {
  color: var(--ink);
}

@media (max-width: 620px) {
  .presets {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
