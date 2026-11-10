<script setup lang="ts">
import { computed, ref } from 'vue'
import type { QueueItem } from '@shared/types'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{
  items: QueueItem[]
  activeIndex: number | null
  order: number[]
  busy: boolean
}>()

const emit = defineEmits<{
  play: [index: number]
  remove: [id: string]
  clear: []
  move: [from: number, to: number]
}>()

const dragging = ref<number | null>(null)

/** Items in play order; the index stays the real queue position. */
const rows = computed(() => {
  const order = props.order.length === props.items.length
    ? props.order
    : props.items.map((_, index) => index)
  return order.flatMap((index) => {
    const item = props.items[index]
    return item ? [{ item, index }] : []
  })
})

/** Touch and shuffle: manual moves only make sense in identity order. */
const canReorder = computed(() => rows.value.every((row, position) => row.index === position))

function meta(item: QueueItem): string {
  return item.isLive === false ? 'Track' : 'Live stream'
}

function onDragStart(index: number): void {
  dragging.value = index
}

function onDrop(index: number): void {
  if (dragging.value !== null && dragging.value !== index) {
    emit('move', dragging.value, index)
  }
  dragging.value = null
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
        v-for="row in rows"
        :key="row.item.id"
        class="row"
        :class="{ active: row.index === activeIndex, dragging: dragging === row.index }"
        :draggable="canReorder"
        @dragstart="onDragStart(row.index)"
        @dragover.prevent
        @drop="onDrop(row.index)"
        @dragend="dragging = null"
      >
        <button
          type="button"
          class="row-main"
          :disabled="busy"
          :aria-current="row.index === activeIndex ? 'true' : undefined"
          :aria-label="`Play ${row.item.title ?? row.item.url}`"
          @click="emit('play', row.index)"
        >
          <span v-if="row.item.artworkUrl" class="row-art" aria-hidden="true">
            <img :src="row.item.artworkUrl" alt="" loading="lazy" />
          </span>
          <span class="row-text">
            <span class="row-name">{{ row.item.title ?? row.item.url }}</span>
            <span class="row-meta">{{ meta(row.item) }}</span>
          </span>
        </button>
        <button
          v-if="canReorder"
          type="button"
          class="row-move"
          :disabled="busy || row.index === 0"
          :aria-label="`Move ${row.item.title ?? row.item.url} up`"
          @click="emit('move', row.index, row.index - 1)"
        >
          ↑
        </button>
        <button
          v-if="canReorder"
          type="button"
          class="row-move"
          :disabled="busy || row.index === items.length - 1"
          :aria-label="`Move ${row.item.title ?? row.item.url} down`"
          @click="emit('move', row.index, row.index + 1)"
        >
          ↓
        </button>
        <button
          type="button"
          class="row-remove"
          :disabled="busy"
          :aria-label="`Remove ${row.item.title ?? row.item.url} from the queue`"
          @click="emit('remove', row.item.id)"
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
  cursor: grab;
}

.row.dragging {
  opacity: 0.5;
}

.row:hover {
  background: var(--hover);
}

.row.active {
  background: var(--accent-soft);
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  text-align: left;
  cursor: pointer;
}

.row-art {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-art);
  box-shadow: inset 0 0 0 1px var(--line-inset);
}

.row-art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.row-text {
  display: grid;
  gap: 2px;
  min-width: 0;
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

.row-move {
  display: none;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--ink-faint);
  font: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}

.row-move:hover:not(:disabled) {
  color: var(--ink);
}

.row-move:disabled {
  opacity: 0.3;
  cursor: default;
}

/* HTML5 drag does not work on touch; show buttons instead. */
@media (hover: none), (max-width: 860px) {
  .row-move {
    display: grid;
  }

  .row-move,
  .row-remove {
    width: 38px;
    height: 38px;
  }

  .row {
    cursor: default;
  }
}

.hint {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: var(--ink-faint);
}
</style>
