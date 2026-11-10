<script setup lang="ts">
import { computed } from 'vue'
import type { LibraryEntry } from '@shared/types'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{
  entries: LibraryEntry[]
  total: number
  mediaBaseUrl: string
  query: string
  busy: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  play: [entry: LibraryEntry]
  queue: [entry: LibraryEntry]
  more: []
}>()

const unreachable = computed(() => /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(props.mediaBaseUrl))

function size(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  if (megabytes >= 1) {
    return `${megabytes.toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function meta(entry: LibraryEntry): string {
  return `${entry.libraryName} · ${entry.path} · ${size(entry.size)}`
}
</script>

<template>
  <section class="group">
    <h3>Tracks</h3>

    <p class="count-line">{{ total.toLocaleString() }} {{ total === 1 ? 'track' : 'tracks' }}</p>

    <p v-if="unreachable" class="warn" role="status">
      The speaker cannot reach {{ mediaBaseUrl }}. Set Media URL in Speaker settings.
    </p>

    <ul v-if="entries.length" class="list">
      <li v-for="entry in entries" :key="entry.id" class="row">
        <button
          type="button"
          class="row-main"
          :disabled="busy"
          :aria-label="`Play ${entry.name}`"
          @click="emit('play', entry)"
        >
          <span class="row-name">{{ entry.name }}</span>
          <span class="row-meta">{{ meta(entry) }}</span>
        </button>
        <button
          type="button"
          class="row-queue"
          :disabled="busy"
          :aria-label="`Add ${entry.name} to the queue`"
          @click="emit('queue', entry)"
        >
          <AppIcon name="plus" :size="14" />
        </button>
        <AppIcon name="play" :size="14" class="row-icon" />
      </li>
    </ul>

    <p v-else-if="loading" class="hint">Reading the library…</p>
    <p v-else-if="query.trim()" class="hint">Nothing matches “{{ query.trim() }}”.</p>
    <p v-else class="hint">No audio files in this folder yet.</p>

    <div v-if="entries.length" class="more">
      <span class="count">{{ entries.length }} of {{ total }}</span>
      <button
        v-if="entries.length < total"
        type="button"
        class="text-button"
        :disabled="loading"
        @click="emit('more')"
      >
        {{ loading ? 'Loading…' : 'Show more' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.group h3 {
  margin: 12px 0 6px;
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.count-line {
  margin: 0 0 6px;
  font-size: 0.72rem;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.warn {
  margin: 0 0 8px;
  font-size: 0.78rem;
  color: var(--danger);
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
  background: var(--hover);
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

.row-meta {
  overflow: hidden;
  font-size: 0.74rem;
  color: var(--ink-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-queue {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--ink-faint);
  cursor: pointer;
}

.row-queue:hover {
  color: var(--ink);
}

.row-icon {
  margin-right: 10px;
  color: var(--ink-faint);
}

.more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 8px;
}

.count {
  font-size: 0.72rem;
  color: var(--ink-faint);
}

.hint {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: var(--ink-faint);
}
</style>
