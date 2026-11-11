<script setup lang="ts">
import { computed } from 'vue'
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
  open: []
}>()

/** The next few tracks in play order, after the active one. */
const rows = computed(() => {
  const order = props.order.length === props.items.length
    ? props.order
    : props.items.map((_, index) => index)
  const position = props.activeIndex === null ? -1 : order.indexOf(props.activeIndex)
  return order.slice(position + 1, position + 6).flatMap((index, offset) => {
    const item = props.items[index]
    return item ? [{ item, index, number: position + offset + 2 }] : []
  })
})
</script>

<template>
  <aside class="up-next" aria-label="Up next">
    <header class="up-next-head">
      <h2>Up next</h2>
      <span class="count">{{ items.length }}</span>
    </header>

    <ul v-if="rows.length" class="list">
      <li v-for="row in rows" :key="row.item.id">
        <button type="button" class="row" :disabled="busy" @click="emit('play', row.index)">
          <span class="row-index">{{ row.number }}</span>
          <span class="row-text">
            <span class="row-name">{{ row.item.title ?? row.item.url }}</span>
            <span class="row-meta">{{ row.item.isLive === false ? 'Track' : 'Live stream' }}</span>
          </span>
        </button>
      </li>
    </ul>

    <p v-else class="hint">Nothing queued. Play an album from the library.</p>

    <button type="button" class="open" @click="emit('open')">
      Open queue
      <AppIcon name="next" :size="13" />
    </button>
  </aside>
</template>

<style scoped>
.up-next {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background:
    linear-gradient(180deg, var(--panel-sheen), var(--panel-sheen-faint)),
    rgba(13, 13, 15, 0.6);
}

.up-next-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.up-next-head h2 {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.count {
  font-size: 0.72rem;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.list {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  width: 100%;
  padding: 9px 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.row-index {
  font-size: 0.68rem;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.row-text {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.row:hover:not(:disabled) {
  background: var(--hover);
}

.row:disabled {
  cursor: progress;
}

.row-name {
  overflow: hidden;
  font-size: 0.84rem;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  font-size: 0.7rem;
  color: var(--ink-faint);
}

.hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--ink-faint);
}

.open {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: auto;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
}

.open:hover {
  border-color: var(--accent-line);
}

@media (max-width: 1199px) {
  .up-next {
    display: none;
  }
}
</style>
