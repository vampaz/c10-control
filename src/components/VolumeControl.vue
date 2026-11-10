<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{
  level: number
  muted: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  volume: [level: number]
  mute: [muted: boolean]
}>()

const dragging = ref(false)
const draft = ref(props.level)

watch(() => props.level, (next) => {
  if (!dragging.value) {
    draft.value = next
  }
})

const shown = computed(() => (props.muted ? 0 : draft.value))
const fill = computed(() => (props.muted ? 0 : draft.value))

function onInput(event: Event): void {
  dragging.value = true
  draft.value = Number((event.target as HTMLInputElement).value)
}

function onCommit(): void {
  dragging.value = false
  if (props.muted) {
    emit('mute', false)
  }
  emit('volume', draft.value)
}
</script>

<template>
  <div class="volume">
    <button
      type="button"
      class="icon-button"
      :aria-label="muted ? 'Unmute' : 'Mute'"
      :aria-pressed="muted"
      :disabled="busy"
      @click="emit('mute', !muted)"
    >
      <AppIcon :name="muted ? 'mute' : 'volume'" :size="20" />
    </button>

    <input
      class="range"
      type="range"
      min="0"
      max="100"
      step="1"
      :value="shown"
      :style="{ '--fill': `${fill}%` }"
      :aria-valuetext="`${shown} percent`"
      aria-label="Volume"
      @input="onInput"
      @change="onCommit"
    />

    <span class="level">{{ shown }}</span>
  </div>
</template>

<style scoped>
.volume {
  display: flex;
  align-items: center;
  gap: 16px;
}

.volume .range {
  flex: 1;
}

.level {
  min-width: 2.2ch;
  text-align: right;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  color: var(--ink-dim);
}
</style>
