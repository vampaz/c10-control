<script setup lang="ts">
import { ref } from 'vue'
import type { LibraryAlbum } from '@shared/types'
import AppIcon from '@/components/AppIcon.vue'

defineProps<{
  albums: LibraryAlbum[]
  total: number
  loading: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  open: [album: LibraryAlbum]
  more: []
}>()

const failed = ref<Set<string>>(new Set())

function onError(id: string): void {
  failed.value = new Set(failed.value).add(id)
}

function meta(album: LibraryAlbum): string {
  const tracks = `${album.trackCount} ${album.trackCount === 1 ? 'track' : 'tracks'}`
  return [tracks, album.artist, album.libraryName].filter(Boolean).join(' · ')
}
</script>

<template>
  <section class="group">
    <h3>Albums</h3>

    <p class="count-line">{{ total.toLocaleString() }} {{ total === 1 ? 'album' : 'albums' }}</p>

    <ul v-if="albums.length" class="grid">
      <li v-for="album in albums" :key="album.id">
        <button
          type="button"
          class="card"
          :disabled="busy"
          :aria-label="`Open ${album.name}`"
          :title="album.name"
          @click="emit('open', album)"
        >
          <span class="cover">
            <img
              v-if="!failed.has(album.id)"
              :src="album.artworkUrl"
              alt=""
              loading="lazy"
              @error="onError(album.id)"
            />
            <span v-else class="fallback" aria-hidden="true">
              <AppIcon name="broadcast" :size="22" />
            </span>
          </span>
          <span class="name">{{ album.name }}</span>
          <span class="meta">{{ meta(album) }}</span>
        </button>
      </li>
    </ul>

    <p v-else-if="loading" class="hint">Reading the library…</p>
    <p v-else class="hint">No albums here yet.</p>

    <div v-if="albums.length" class="more">
      <span class="count">{{ albums.length }} of {{ total }}</span>
      <button
        v-if="albums.length < total"
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
  margin: 0 0 10px;
  font-size: 0.72rem;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 14px 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.card {
  display: grid;
  gap: 3px;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.card:disabled {
  cursor: progress;
  opacity: 0.6;
}

.cover {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  margin-bottom: 6px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface-art);
  box-shadow: inset 0 0 0 1px var(--line-inset);
  transition: transform 160ms ease;
}

.card:hover .cover {
  transform: scale(1.02);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.fallback {
  color: var(--ink-faint);
}

.name {
  overflow: hidden;
  font-size: 0.82rem;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  overflow: hidden;
  font-size: 0.72rem;
  color: var(--ink-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.count {
  font-size: 0.72rem;
  color: var(--ink-faint);
}

@media (prefers-reduced-motion: reduce) {
  .card:hover .cover {
    transform: none;
  }
}
</style>
