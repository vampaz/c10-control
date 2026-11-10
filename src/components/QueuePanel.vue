<script setup lang="ts">
import type { QueueItem } from '@shared/types'
import AppIcon from '@/components/AppIcon.vue'

defineProps<{
  items: QueueItem[]
  activeIndex: number | null
  busy: boolean
}>()

const emit = defineEmits<{
  play: [index: number]
  remove: [id: string]
  clear: []
}>()

function meta(item: QueueItem): string {
  return item.isLive === false ? 'Track' : 'Live stream'
}
</script>

<template>
  <section class="group">
    <header class="queue-head">
      <h3>Queue</h3>
      <button v-if="items.length" type="button" class="text-button" :disabled="busy" @click="emit('clear')">
        Clear
      </button>
    </header>

    <ul v-if="items.length" class="list">
      <li
        v-for="(item, index) in items"
        :key="item.id"
        class="row"
        :class="{ active: index === activeIndex }"
      >
        <button
          type="button"
          class="row-main"
          :disabled="busy"
          :aria-current="index === activeIndex ? 'true' : undefined"
          :aria-label="`Play ${item.title ?? item.url}`"
          @click="emit('play', index)"
        >
          <span class="row-name">{{ item.title ?? item.url }}</span>
          <span class="row-meta">{{ meta(item) }}</span>
        </button>
        <button
          type="button"
          class="row-remove"
          :disabled="busy"
          :aria-label="`Remove ${item.title ?? item.url} from the queue`"
          @click="emit('remove', item.id)"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </li>
    </ul>

    <p v-else class="hint">Add tracks from the Library tab, then they play one after another.</p>
  </section>
</template>

<style scoped>
.queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.group h3 {
  margin: 12px 0 6px;
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 10px;
  transition: background 140ms ease;
}

.row:hover {
  background: rgba(255, 255, 255, 0.045);
}

.row.active {
  background: rgba(232, 176, 106, 0.09);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 9px 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  text-align: left;
  cursor: pointer;
}

.row-main:disabled {
  cursor: progress;
  opacity: 0.6;
}

.row-name {
  overflow: hidden;
  font-size: 0.92rem;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row.active .row-name {
  color: var(--accent);
}

.row-meta {
  font-size: 0.74rem;
  color: var(--ink-faint);
}

.row-remove {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  margin-right: 4px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--ink-faint);
  cursor: pointer;
}

.row-remove:hover {
  color: var(--ink);
}

.hint {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: var(--ink-faint);
}
</style>
