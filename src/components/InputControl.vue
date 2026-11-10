<script setup lang="ts">
import type { SpeakerInput } from '@shared/types'

defineProps<{
  current: SpeakerInput | null
  busy: boolean
}>()

const emit = defineEmits<{ input: [mode: SpeakerInput] }>()

const INPUTS: { value: SpeakerInput; label: string }[] = [
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'bluetooth', label: 'Bluetooth' },
  { value: 'line-in', label: 'Aux' },
  { value: 'optical', label: 'Optical' },
]
</script>

<template>
  <div class="inputs" title="Switching input stops the current stream">
    <span class="label">Input</span>
    <div class="options" role="group" aria-label="Input">
      <button
        v-for="input in INPUTS"
        :key="input.value"
        type="button"
        :class="{ active: current === input.value }"
        :aria-pressed="current === input.value"
        :disabled="busy"
        @click="emit('input', input.value)"
      >
        {{ input.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.inputs {
  display: flex;
  align-items: center;
  gap: 10px;
}

@media (max-width: 520px) {
  .inputs {
    flex-wrap: wrap;
    justify-content: center;
  }
}

.label {
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.options button {
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--ink-dim);
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}

.options button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--ink);
}

.options button.active {
  border-color: var(--accent);
  color: var(--accent);
}

.options button:disabled {
  opacity: 0.45;
  cursor: progress;
}
</style>
