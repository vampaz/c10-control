<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AppConfig, CommandType, PlayTarget, QueueSnapshot, RepeatMode, SpeakerInput } from '@shared/types'
import { clearPreset, fetchConfig, fetchQueue, listPresets, playQueue, savePreset, setQueueMode } from '@/api'
import { prettyModel } from '@/format'
import { useSpeaker } from '@/composables/useSpeaker'
import AppIcon from '@/components/AppIcon.vue'
import ArtworkTile from '@/components/ArtworkTile.vue'
import BrowsePanel from '@/components/BrowsePanel.vue'
import DevicePanel from '@/components/DevicePanel.vue'
import InputControl from '@/components/InputControl.vue'
import PresetBar from '@/components/PresetBar.vue'
import QueueModes from '@/components/QueueModes.vue'
import SleepControl from '@/components/SleepControl.vue'
import TrackInfo from '@/components/TrackInfo.vue'
import TransportControls from '@/components/TransportControls.vue'
import UpNext from '@/components/UpNext.vue'
import VolumeControl from '@/components/VolumeControl.vue'

const { state, stream, busy, commandError, online, playing, run, play } = useSpeaker()

const config = ref<AppConfig>({ host: '', httpPort: 80, upnpPort: 49152, libraries: [], browseRoots: [], mediaBaseUrl: '' })
const configLoaded = ref(false)
const settingsOpen = ref(new URLSearchParams(window.location.search).get('settings') === '1')
const settingsButton = ref<HTMLButtonElement | null>(null)
const browseOpen = ref(new URLSearchParams(window.location.search).get('browse') === '1')
const initialBrowseTab = ((): 'radio' | 'library' | 'queue' | 'playlists' => {
  const value = new URLSearchParams(window.location.search).get('tab')
  return value === 'library' || value === 'queue' || value === 'playlists' ? value : 'radio'
})()
const browseTab = ref<'radio' | 'library' | 'queue' | 'playlists'>(initialBrowseTab)
const browseButton = ref<HTMLButtonElement | null>(null)
const presets = ref<(PlayTarget | null)[]>(Array.from({ length: 6 }, () => null))
const presetError = ref<string | null>(null)
const queueMode = ref<{ repeat: RepeatMode; shuffle: boolean }>({ repeat: 'off', shuffle: false })
const modeError = ref<string | null>(null)
const queue = ref<QueueSnapshot>({ items: [], activeIndex: null, repeat: 'off', shuffle: false, order: [] })

async function refreshQueue(): Promise<void> {
  const next = await fetchQueue().catch(() => null)
  if (next) {
    queue.value = next
    queueMode.value = { repeat: next.repeat, shuffle: next.shuffle }
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  config.value = await fetchConfig().catch(() => config.value)
  configLoaded.value = true
  presets.value = await listPresets().catch(() => presets.value)
  await refreshQueue()
})

// Auto-advance changes the queue on the server, so follow track changes.
watch(() => state.value.playback.url, () => {
  void refreshQueue()
})

const ambientKey = computed(() => state.value.playback.artworkUrl ?? 'none')
const ambientStyle = computed(() => state.value.playback.artworkUrl
  ? { backgroundImage: `url("${state.value.playback.artworkUrl}")` }
  : {})

const currentTarget = computed<PlayTarget | null>(() => {
  const { playback } = state.value
  if (!playback.url) {
    return null
  }
  return {
    url: playback.url,
    title: playback.title || undefined,
    artist: playback.artist && playback.artist.toLowerCase() !== 'unknown' ? playback.artist : undefined,
    artworkUrl: playback.artworkUrl,
    isLive: playback.isLive,
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

const statusLabel = computed(() => {
  if (stream.value === 'offline') {
    return 'App server offline'
  }
  if (!online.value) {
    return 'Speaker offline'
  }
  return 'Connected'
})

const offlineHint = computed(() => {
  if (state.value.error) {
    return state.value.error
  }
  return config.value.host
    ? `Check that ${config.value.host} is powered on and on this network.`
    : 'Check that the speaker is powered on and on this network.'
})

function onCommand(type: CommandType, value?: number): void {
  void run({ type, value })
}

function onVolume(level: number): void {
  void run({ type: 'volume', value: level })
}

function onMute(muted: boolean): void {
  void run({ type: 'mute', value: muted })
}

function onInput(mode: SpeakerInput): void {
  void run({ type: 'input', value: mode })
}

async function setMode(patch: { repeat?: RepeatMode; shuffle?: boolean }): Promise<void> {
  modeError.value = null
  try {
    const queue = await setQueueMode(patch)
    queueMode.value = { repeat: queue.repeat, shuffle: queue.shuffle }
  } catch (error) {
    modeError.value = error instanceof Error ? error.message : 'The playback mode could not be changed'
  }
}

function onRepeat(mode: RepeatMode): void {
  void setMode({ repeat: mode })
}

function onShuffle(enabled: boolean): void {
  void setMode({ shuffle: enabled })
}

async function onUpNext(index: number): Promise<void> {
  modeError.value = null
  try {
    queue.value = await playQueue(index)
  } catch (error) {
    modeError.value = error instanceof Error ? error.message : 'That track could not play'
  }
}

function openQueue(): void {
  browseTab.value = 'queue'
  browseOpen.value = true
}

function onPresetPlay(target: PlayTarget): void {
  void play(target)
}

async function onPresetSave(index: number): Promise<void> {
  const target = currentTarget.value
  if (!target) {
    return
  }
  presetError.value = null
  try {
    presets.value = await savePreset(index, target)
  } catch (error) {
    presetError.value = error instanceof Error ? error.message : 'The preset could not be saved'
  }
}

async function onPresetClear(index: number): Promise<void> {
  presetError.value = null
  try {
    presets.value = await clearPreset(index)
  } catch (error) {
    presetError.value = error instanceof Error ? error.message : 'The preset could not be cleared'
  }
}

function onSaved(next: AppConfig): void {
  config.value = next
}

function openSettings(): void {
  settingsOpen.value = true
}

function closeSettings(): void {
  settingsOpen.value = false
  settingsButton.value?.focus()
}

function toggleBrowse(): void {
  if (browseOpen.value) {
    closeBrowse()
    return
  }
  browseOpen.value = true
}

function closeBrowse(): void {
  browseOpen.value = false
  browseButton.value?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return
  }

  // Leave typing, buttons and the settings dialog to their own handlers.
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, button, a, [role="dialog"]')) {
    return
  }

  if (event.key === 'Escape' && browseOpen.value) {
    event.preventDefault()
    closeBrowse()
    return
  }

  const { playback, volume } = state.value

  switch (event.key) {
    case ' ':
      event.preventDefault()
      onCommand('toggle')
      break
    case 'ArrowUp':
      event.preventDefault()
      onVolume(Math.min(100, volume.level + 2))
      break
    case 'ArrowDown':
      event.preventDefault()
      onVolume(Math.max(0, volume.level - 2))
      break
    case 'ArrowRight':
      if (!playback.isLive && playback.duration > 0) {
        event.preventDefault()
        onCommand('seek', Math.min(playback.duration, playback.position + 10))
      }
      break
    case 'ArrowLeft':
      if (!playback.isLive && playback.duration > 0) {
        event.preventDefault()
        onCommand('seek', Math.max(0, playback.position - 10))
      }
      break
    case 'm':
      onMute(!volume.muted)
      break
  }
}
</script>

<template>
  <div class="app" :class="{ 'is-playing': playing, 'browse-open': browseOpen }">
    <div class="ambient" aria-hidden="true">
      <div :key="ambientKey" class="ambient-image" :style="ambientStyle" />
    </div>

    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">C10</span>
        <div class="brand-text">
          <p class="brand-name">{{ state.device?.name ?? 'Audio Pro C10' }}</p>
          <p class="brand-meta">{{ state.source }}<template v-if="state.device?.firmware"> · fw {{ state.device.firmware }}</template></p>
        </div>
      </div>

      <div class="topbar-side">
        <span class="status" :data-stream="stream" :data-online="online" aria-live="polite">
          <i class="dot" aria-hidden="true" />
          {{ statusLabel }}
        </span>
        <button
          ref="browseButton"
          type="button"
          class="browse-button"
          :aria-expanded="browseOpen"
          aria-controls="browse-panel"
          @click="toggleBrowse"
        >
          <AppIcon name="browse" :size="16" />
          Browse
        </button>
        <button
          ref="settingsButton"
          type="button"
          class="icon-button"
          aria-label="Speaker settings"
          @click="openSettings"
        >
          <AppIcon name="settings" :size="19" />
        </button>
      </div>
    </header>

    <main class="console">
      <div class="player-column">
        <section class="panel" aria-label="Controls">
          <div class="now-playing">
            <ArtworkTile :playback="state.playback" :playing="playing" />
            <TrackInfo :playback="state.playback" :playing="playing" :online="online" />
          </div>


          <div v-if="!online && state.updatedAt > 0" class="notice" role="status">
            <p class="notice-title">Speaker unreachable</p>
            <p class="notice-text">{{ offlineHint }}</p>
            <button type="button" class="text-button" @click="openSettings">Change device</button>
          </div>

          <TransportControls
            :status="state.playback.status"
            :position="state.playback.position"
            :duration="state.playback.duration"
            :is-live="state.playback.isLive"
            :busy="busy"
            @command="onCommand"
          />

          <QueueModes
            :repeat="queueMode.repeat"
            :shuffle="queueMode.shuffle"
            :busy="busy"
            @repeat="onRepeat"
            @shuffle="onShuffle"
          />

          <VolumeControl :level="state.volume.level" :muted="state.volume.muted" :busy="busy" @volume="onVolume" @mute="onMute" />

          <SleepControl />

          <PresetBar
            :presets="presets"
            :current="currentTarget"
            :busy="busy"
            @play="onPresetPlay"
            @save="onPresetSave"
            @clear="onPresetClear"
          />

          <p v-if="presetError" class="error" role="alert">{{ presetError }}</p>
          <p v-if="modeError" class="error" role="alert">{{ modeError }}</p>
          <p v-if="commandError" class="error" role="alert">{{ commandError }}</p>
        </section>

        <InputControl :current="state.input" :busy="busy" @input="onInput" />
      </div>

      <UpNext
        v-if="!browseOpen"
        :items="queue.items"
        :active-index="queue.activeIndex"
        :order="queue.order"
        :busy="busy"
        @play="onUpNext"
        @open="openQueue"
      />
    </main>

    <footer class="footer">
      <span>{{ prettyModel(state.device?.model) }}</span>
      <span>{{ config.host }}</span>
    </footer>

    <DevicePanel
      v-if="settingsOpen && configLoaded"
      :config="config"
      :device="state.device"
      @close="closeSettings"
      @saved="onSaved"
    />

    <BrowsePanel v-if="browseOpen" :initial-tab="browseTab" @close="closeBrowse" />
  </div>
</template>
