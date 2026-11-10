<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppConfig, DeviceInfo, DiscoveredDevice, LibraryRoot } from '@shared/types'
import { discoverDevices, updateConfig } from '@/api'
import { prettyModel } from '@/format'
import { useFocusTrap } from '@/composables/useFocusTrap'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps<{
  config: AppConfig
  device: DeviceInfo | null
}>()

const emit = defineEmits<{
  close: []
  saved: [config: AppConfig]
}>()

const host = ref(props.config.host)
const libraries = ref<LibraryRoot[]>(props.config.libraries.map((library) => ({ ...library })))
const newName = ref('')
const newPath = ref('')
const mediaBaseUrl = ref(props.config.mediaBaseUrl)
const devices = ref<DiscoveredDevice[]>([])
const searching = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const searched = ref(false)
const hostInput = ref<HTMLInputElement | null>(null)
const { container: dialog } = useFocusTrap(() => emit('close'))

onMounted(() => {
  const input = hostInput.value
  if (input && !input.disabled) {
    input.focus()
    input.select()
  } else {
    dialog.value?.querySelector<HTMLElement>('.dialog-head button')?.focus()
  }
})

async function search(): Promise<void> {
  searching.value = true
  error.value = null
  try {
    devices.value = await discoverDevices()
    searched.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Search failed'
  } finally {
    searching.value = false
  }
}

function choose(device: DiscoveredDevice): void {
  host.value = device.host
}

function addLibrary(): void {
  const path = newPath.value.trim()
  if (!path) {
    return
  }
  libraries.value = [...libraries.value, { id: '', name: newName.value.trim(), path }]
  newName.value = ''
  newPath.value = ''
}

function removeLibrary(index: number): void {
  libraries.value = libraries.value.filter((_, position) => position !== index)
}

async function save(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    const next = await updateConfig({
      host: host.value.trim(),
      libraries: libraries.value.map((library) => ({
        id: library.id,
        name: library.name,
        path: library.path,
      })),
      mediaBaseUrl: mediaBaseUrl.value.trim(),
    })
    emit('saved', next)
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save the settings'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section ref="dialog" class="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="dialog-head">
        <h2 id="settings-title">Speaker</h2>
        <button type="button" class="icon-button" aria-label="Close settings" @click="emit('close')">
          <AppIcon name="close" :size="18" />
        </button>
      </header>

      <label class="field">
        <span class="field-label">Address</span>
        <input
          ref="hostInput"
          v-model="host"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          spellcheck="false"
          placeholder="192.168.1.100"
          :disabled="config.pinnedHost"
        />
      </label>
      <p v-if="config.pinnedHost" class="hint">
        Fixed by <code>C10_HOST</code> in the environment. Change it there and restart.
      </p>

      <div class="field">
        <span class="field-label">Music folders</span>
        <ul v-if="libraries.length" class="libraries">
          <li v-for="(library, index) in libraries" :key="`${library.path}-${index}`">
            <span class="library-text">
              <strong>{{ library.name || library.path }}</strong>
              <small>{{ library.path }}</small>
            </span>
            <button
              type="button"
              class="icon-button"
              :aria-label="`Remove ${library.name || library.path}`"
              @click="removeLibrary(index)"
            >
              <AppIcon name="close" :size="14" />
            </button>
          </li>
        </ul>
        <div class="library-add">
          <input v-model="newName" type="text" placeholder="Name (optional)" autocomplete="off" />
          <input v-model="newPath" type="text" placeholder="/music" autocomplete="off" spellcheck="false" />
          <button type="button" class="ghost" :disabled="!newPath.trim()" @click="addLibrary">Add</button>
        </div>
      </div>
      <p class="hint">Each folder becomes a library in Browse → Library. The server must be able to read it.</p>

      <label class="field">
        <span class="field-label">Media URL</span>
        <input
          v-model="mediaBaseUrl"
          type="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="http://192.168.1.135:5173"
        />
      </label>
      <p class="hint">The address the speaker uses to fetch local files. Leave empty to detect it.</p>

      <div v-if="!config.pinnedHost" class="search">
        <button type="button" class="text-button" :disabled="searching" @click="search">
          {{ searching ? 'Searching…' : 'Find speakers on this network' }}
        </button>
        <ul v-if="devices.length" class="results">
          <li v-for="found in devices" :key="found.location">
            <button type="button" class="result" @click="choose(found)">
              <span class="result-name">{{ found.name }}</span>
              <span class="result-host">{{ found.host }}</span>
            </button>
          </li>
        </ul>
        <p v-else-if="searched && !searching" class="hint">No speakers answered. Enter the address by hand.</p>
      </div>

      <dl v-if="device" class="facts">
        <div><dt>Model</dt><dd>{{ prettyModel(device.model) }}</dd></div>
        <div><dt>Firmware</dt><dd>{{ device.firmware }}</dd></div>
        <div><dt>UUID</dt><dd class="mono">{{ device.uuid || '—' }}</dd></div>
      </dl>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <footer class="dialog-foot">
        <button type="button" class="ghost" @click="emit('close')">Cancel</button>
        <button type="button" class="primary" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 4, 5, 0.72);
  backdrop-filter: blur(8px);
}

.dialog {
  width: min(440px, 100%);
  display: grid;
  gap: 18px;
  padding: 22px;
  border-radius: 20px;
  border: 1px solid var(--line);
  background: #121214;
  box-shadow: 0 40px 80px -40px #000;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.field {
  display: grid;
  gap: 8px;
}

.field-label,
.facts dt {
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.field input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #191a1c;
  color: var(--ink);
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.field input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.field input:disabled {
  color: var(--ink-dim);
  background: #151618;
}

.libraries {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.libraries li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #17181a;
}

.library-text {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.library-text strong {
  overflow: hidden;
  font-size: 0.86rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-text small {
  overflow: hidden;
  font-size: 0.72rem;
  color: var(--ink-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-add {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) auto;
  gap: 6px;
}

.library-add input {
  min-width: 0;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #191a1c;
  color: var(--ink);
  font: inherit;
  font-size: 0.82rem;
}

.library-add input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.search {
  display: grid;
  gap: 10px;
}

.results {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.result {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #191a1c;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.result:hover {
  border-color: var(--accent);
}

.result-host {
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
  font-size: 0.85rem;
}

.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--ink-faint);
}

.facts {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-top: 4px;
  border-top: 1px solid var(--line);
}

.facts div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.facts dd {
  margin: 0;
  font-size: 0.85rem;
  color: var(--ink-dim);
  text-align: right;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.72rem;
  word-break: break-all;
}

.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
