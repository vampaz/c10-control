<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppConfig, DeviceInfo, DiscoveredDevice, FolderListing, LibraryRoot, SpeakerInput } from '@shared/types'
import { discoverDevices, fetchDeviceDetails, fetchFolders, renameSpeaker, updateConfig } from '@/api'
import type { DeviceDetails } from '@shared/types'
import { prettyModel } from '@/format'
import { useFocusTrap } from '@/composables/useFocusTrap'
import AppIcon from '@/components/AppIcon.vue'
import InputControl from '@/components/InputControl.vue'

const props = withDefaults(defineProps<{
  config: AppConfig
  device: DeviceInfo | null
  input?: SpeakerInput | null
  busy?: boolean
}>(), { input: null, busy: false })

const emit = defineEmits<{
  close: []
  saved: [config: AppConfig]
  input: [mode: SpeakerInput]
}>()

const host = ref(props.config.host)
const libraries = ref<LibraryRoot[]>(props.config.libraries.map((library) => ({ ...library })))
const newName = ref('')
const newPath = ref('')
const newPathInput = ref<HTMLInputElement | null>(null)
const libraryError = ref<string | null>(null)
const folderListing = ref<FolderListing | null>(null)
const folderLoading = ref(false)
const folderError = ref<string | null>(null)
const mediaBaseUrl = ref(props.config.mediaBaseUrl)
const devices = ref<DiscoveredDevice[]>([])
const searching = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const searched = ref(false)
const hostInput = ref<HTMLInputElement | null>(null)
const details = ref<DeviceDetails | null>(null)
const detailError = ref<string | null>(null)
const renameValue = ref(props.device?.name ?? '')
const renaming = ref(false)
const renameError = ref<string | null>(null)
const { container: dialog } = useFocusTrap(() => emit('close'))

onMounted(() => {
  const input = hostInput.value
  if (input && !input.disabled) {
    input.focus()
    input.select()
  } else {
    dialog.value?.querySelector<HTMLElement>('.dialog-head button')?.focus()
  }
  void loadDetails()
})

async function loadDetails(): Promise<void> {
  detailError.value = null
  try {
    details.value = await fetchDeviceDetails()
    if (!renameValue.value) {
      renameValue.value = details.value.name
    }
  } catch (error) {
    detailError.value = error instanceof Error ? error.message : 'Speaker details are unavailable'
  }
}

async function rename(): Promise<void> {
  const name = renameValue.value.trim()
  if (!name) {
    return
  }
  renaming.value = true
  renameError.value = null
  try {
    const result = await renameSpeaker(name)
    renameValue.value = result.name
    if (details.value) {
      details.value = { ...details.value, name: result.name }
    }
  } catch (error) {
    renameError.value = error instanceof Error ? error.message : 'The speaker could not be renamed'
  } finally {
    renaming.value = false
  }
}

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
    libraryError.value = 'Enter a folder path first.'
    newPathInput.value?.focus()
    return
  }
  libraryError.value = null
  libraries.value = [...libraries.value, { id: '', name: newName.value.trim(), path }]
  newName.value = ''
  newPath.value = ''
}

function removeLibrary(index: number): void {
  libraries.value = libraries.value.filter((_, position) => position !== index)
}

async function openBrowser(): Promise<void> {
  libraryError.value = null
  folderError.value = null
  folderLoading.value = true
  try {
    folderListing.value = await fetchFolders(newPath.value.trim())
  } catch (cause) {
    folderError.value = cause instanceof Error ? cause.message : 'Could not open the folder browser'
  } finally {
    folderLoading.value = false
  }
}

async function navigateFolder(path: string): Promise<void> {
  folderError.value = null
  folderLoading.value = true
  try {
    folderListing.value = await fetchFolders(path)
  } catch (cause) {
    folderError.value = cause instanceof Error ? cause.message : 'Could not read that folder'
  } finally {
    folderLoading.value = false
  }
}

function chooseFolder(): void {
  if (!folderListing.value) {
    return
  }
  newPath.value = folderListing.value.path
  folderListing.value = null
  folderError.value = null
  libraryError.value = null
}

function closeBrowser(): void {
  folderListing.value = null
  folderError.value = null
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
  <section id="settings-panel" ref="dialog" class="dialog" role="dialog" aria-labelledby="settings-title">
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
        inputmode="text"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        placeholder="192.168.1.100"
        :disabled="config.pinnedHost"
      />
    </label>
    <p class="hint">IP address or host name.</p>
    <p v-if="config.pinnedHost" class="hint">
      Fixed by <code>C10_HOST</code> in the environment. Change it there and restart.
    </p>

    <section class="setting-group">
      <InputControl :current="input" :busy="busy" @input="emit('input', $event)" />
      <p class="hint">Switching input stops the current stream.</p>
    </section>

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
        <input
          ref="newPathInput"
          v-model="newPath"
          type="text"
          placeholder="/path/to/music"
          autocomplete="off"
          spellcheck="false"
          @input="libraryError = null"
          @keydown.enter="addLibrary"
        />
        <button type="button" class="ghost" @click="addLibrary">Add</button>
      </div>
      <p v-if="libraryError" class="library-error" role="alert">{{ libraryError }}</p>

      <div v-if="config.browseRoots.length" class="library-browse">
        <button type="button" class="text-button" :disabled="folderLoading" @click="openBrowser">
          {{ folderLoading && !folderListing ? 'Opening…' : 'Browse folders' }}
        </button>

        <p v-if="folderError" class="library-error" role="alert">{{ folderError }}</p>

        <div v-if="folderListing" class="folder-browser">
          <header class="folder-head">
            <button type="button" class="text-button" :disabled="!folderListing.parent" @click="navigateFolder(folderListing.parent ?? '')">
              Up
            </button>
            <span class="folder-path" :title="folderListing.path">{{ folderListing.path }}</span>
            <button type="button" class="text-button" @click="closeBrowser">Close</button>
          </header>

          <ul v-if="folderListing.folders.length" class="folder-list">
            <li v-for="folder in folderListing.folders" :key="folder.path">
              <button type="button" class="folder-row" @click="navigateFolder(folder.path)">
                {{ folder.name }}
              </button>
            </li>
          </ul>
          <p v-else class="hint">No subfolders here.</p>

          <button type="button" class="primary" @click="chooseFolder">Use this folder</button>
        </div>
      </div>
    </div>
    <p class="hint">Each folder becomes a library in Browse → Library. Use Browse folders for a mounted parent, or type a path the server can read.</p>

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

    <label class="field">
      <span class="field-label">Speaker name</span>
      <div class="rename-row">
        <input
          v-model="renameValue"
          type="text"
          maxlength="40"
          autocomplete="off"
          aria-label="Speaker name"
          @keydown.enter="rename"
        />
        <button type="button" class="ghost" :disabled="renaming || !renameValue.trim()" @click="rename">
          {{ renaming ? 'Renaming…' : 'Rename' }}
        </button>
      </div>
    </label>
    <p v-if="renameError || detailError" class="error" role="alert">{{ renameError ?? detailError }}</p>

    <dl v-if="device" class="facts">
      <div><dt>Model</dt><dd>{{ prettyModel(device.model) }}</dd></div>
      <div><dt>Firmware</dt><dd>{{ device.firmware }}</dd></div>
      <div v-if="details"><dt>Signal</dt><dd>{{ details.rssi !== null ? `${details.rssi} dBm` : '—' }}</dd></div>
      <div v-if="details"><dt>Wi-Fi channel</dt><dd>{{ details.wifiChannel ?? '—' }}</dd></div>
      <div v-if="details"><dt>Internet</dt><dd>{{ details.internet === null ? '—' : details.internet ? 'Online' : 'Offline' }}</dd></div>
      <div v-if="details"><dt>Update</dt><dd>{{ details.versionUpdate === null ? '—' : details.versionUpdate ? 'Available' : 'Up to date' }}</dd></div>
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
</template>

<style scoped>
.dialog {
  position: fixed;
  inset-block: 0;
  right: 0;
  z-index: 10;
  display: grid;
  align-content: start;
  gap: 18px;
  width: 100%;
  height: 100%;
  padding: 22px;
  padding-top: max(22px, env(safe-area-inset-top));
  padding-bottom: max(22px, env(safe-area-inset-bottom));
  overflow-y: auto;
  overscroll-behavior: contain;
  border-left: 1px solid var(--line);
  background: var(--surface);
  box-shadow: -40px 0 80px -40px var(--shadow);
  animation: slide-in 220ms ease-out;
}

@media (min-width: 1000px) {
  .dialog {
    width: var(--browse-width, 480px);
  }
}

@keyframes slide-in {
  from {
    transform: translateX(16px);
  }
  to {
    transform: none;
  }
}

.dialog-head {
  position: sticky;
  top: -22px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: -22px -22px 0;
  padding: 22px 22px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.dialog-head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.setting-group {
  display: grid;
  gap: 6px;
}

.rename-row {
  display: flex;
  gap: 8px;
}

.rename-row input {
  flex: 1;
  min-width: 0;
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
  background: var(--surface-input);
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
  background: var(--surface-disabled);
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
  background: var(--surface-raised);
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
  background: var(--surface-input);
  color: var(--ink);
  font: inherit;
  font-size: 0.82rem;
}

.library-add input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.library-error {
  margin: 0;
  font-size: 0.78rem;
  color: var(--danger);
}

.library-browse {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}

.folder-browser {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-deep);
}

.folder-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.folder-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 0.74rem;
  color: var(--ink-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-list {
  display: grid;
  gap: 2px;
  max-height: 180px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.folder-row {
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--ink-dim);
  font: inherit;
  font-size: 0.84rem;
  text-align: left;
  cursor: pointer;
}

.folder-row:hover {
  background: var(--hover);
  color: var(--ink);
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
  background: var(--surface-input);
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
  position: sticky;
  bottom: -22px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin: 0 -22px -22px;
  padding: 12px 22px 22px;
  border-top: 1px solid var(--line);
  background: var(--surface-deep);
}
</style>
