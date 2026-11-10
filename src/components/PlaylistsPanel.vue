<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Playlist, PlaylistItem } from '@shared/types'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{
  playlists: Playlist[]
  selectedId: string
  busy: boolean
}>()

const emit = defineEmits<{
  create: [name: string]
  select: [id: string]
  rename: [id: string, name: string]
  remove: [id: string]
  play: [id: string]
  addCurrent: [id: string]
  removeItem: [id: string, itemId: string]
}>()

const newName = ref('')
const renameName = ref('')
const editing = ref(false)
const confirmDelete = ref(false)

const selected = computed(() => props.playlists.find((playlist) => playlist.id === props.selectedId) ?? null)

watch(() => props.selectedId, () => {
  editing.value = false
  confirmDelete.value = false
  renameName.value = selected.value?.name ?? ''
})

function create(): void {
  const name = newName.value.trim()
  if (!name) {
    return
  }
  emit('create', name)
  newName.value = ''
}

function startRename(): void {
  if (!selected.value) {
    return
  }
  renameName.value = selected.value.name
  editing.value = true
  confirmDelete.value = false
}

function saveRename(): void {
  const name = renameName.value.trim()
  if (!selected.value || !name) {
    return
  }
  emit('rename', selected.value.id, name)
  editing.value = false
}

function play(): void {
  if (!selected.value) {
    return
  }
  confirmDelete.value = false
  emit('play', selected.value.id)
}

function remove(): void {
  if (!selected.value) {
    return
  }
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  emit('remove', selected.value.id)
  confirmDelete.value = false
}

function meta(item: PlaylistItem): string {
  return item.isLive === false ? 'Track' : 'Live stream'
}
</script>

<template>
  <section class="group">
    <h3>Playlists</h3>

    <div class="create">
      <input
        v-model="newName"
        type="text"
        placeholder="New playlist"
        autocomplete="off"
        @keydown.enter="create"
      />
      <button type="button" class="primary" :disabled="!newName.trim()" @click="create">Add</button>
    </div>

    <ul v-if="playlists.length" class="playlists">
      <li v-for="playlist in playlists" :key="playlist.id">
        <button
          type="button"
          class="playlist-row"
          :class="{ active: playlist.id === selectedId }"
          :aria-current="playlist.id === selectedId ? 'true' : undefined"
          @click="emit('select', playlist.id)"
        >
          <span class="playlist-name">{{ playlist.name }}</span>
          <span class="playlist-count">{{ playlist.items.length }}</span>
        </button>
      </li>
    </ul>

    <p v-else class="hint">No playlists yet. Create one above.</p>

    <div v-if="selected" class="detail">
      <header class="detail-head">
        <strong>{{ selected.name }}</strong>
        <div class="actions">
          <button type="button" class="text-button" :disabled="busy || !selected.items.length" @click="play">
            Play
          </button>
          <button type="button" class="text-button" @click="startRename">Rename</button>
          <button type="button" class="text-button danger" @click="remove">
            {{ confirmDelete ? 'Confirm delete' : 'Delete' }}
          </button>
        </div>
      </header>

      <div v-if="editing" class="rename">
        <input v-model="renameName" type="text" autocomplete="off" @keydown.enter="saveRename" />
        <button type="button" class="primary" :disabled="!renameName.trim()" @click="saveRename">Save</button>
        <button type="button" class="ghost" @click="editing = false">Cancel</button>
      </div>

      <button type="button" class="add-current" :disabled="busy" @click="emit('addCurrent', selected.id)">
        Add the current track
      </button>

      <ul v-if="selected.items.length" class="items">
        <li v-for="item in selected.items" :key="item.id" class="item">
          <span class="item-text">
            <span class="item-name">{{ item.title ?? item.url }}</span>
            <span class="item-meta">{{ meta(item) }}</span>
          </span>
          <button
            type="button"
            class="item-remove"
            :aria-label="`Remove ${item.title ?? item.url}`"
            @click="emit('removeItem', selected.id, item.id)"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </li>
      </ul>
      <p v-else class="hint">Play something, then add it here. Library tracks work best.</p>
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

.create {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.create input,
.rename input {
  flex: 1;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-raised);
  color: var(--ink);
  font: inherit;
  font-size: 0.84rem;
}

.playlists {
  display: grid;
  gap: 2px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.playlist-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: var(--ink-dim);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.playlist-row:hover,
.playlist-row.active {
  background: var(--hover);
}

.playlist-row.active {
  color: var(--ink);
}

.playlist-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-count {
  font-size: 0.72rem;
  color: var(--ink-faint);
}

.detail {
  display: grid;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.detail-head strong {
  overflow: hidden;
  font-size: 0.92rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.danger {
  color: var(--danger);
}

.rename {
  display: flex;
  gap: 6px;
}

.add-current {
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--ink-dim);
  font: inherit;
  font-size: 0.78rem;
  cursor: pointer;
}

.add-current:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--ink);
}

.add-current:disabled {
  opacity: 0.45;
  cursor: default;
}

.items {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
}

.item:hover {
  background: var(--hover);
}

.item-text {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.item-name {
  overflow: hidden;
  font-size: 0.86rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-meta {
  font-size: 0.72rem;
  color: var(--ink-faint);
}

.item-remove {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--ink-faint);
  cursor: pointer;
}

.item-remove:hover {
  color: var(--ink);
}

.hint {
  margin: 6px 0 0;
  font-size: 0.84rem;
  color: var(--ink-faint);
}
</style>
