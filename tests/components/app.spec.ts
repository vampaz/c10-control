// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { emptySpeakerState, type SpeakerState } from '@shared/types'
import App from '@/App.vue'

const emitState = { current: null as ((state: SpeakerState) => void) | null }
const fetchConfig = vi.fn(async () => ({
  host: '192.168.1.100',
  httpPort: 80,
  upnpPort: 49152,
  libraries: [],
  browseRoots: [],
  mediaBaseUrl: '',
}))
const listPresets = vi.fn(async () => Array.from({ length: 6 }, () => null))
const fetchQueue = vi.fn(async () => ({ items: [], activeIndex: null, repeat: 'all' as const, shuffle: false, order: [] }))
const setQueueMode = vi.fn(async (patch: { repeat?: string; shuffle?: boolean }) => ({
  items: [],
  activeIndex: null,
  repeat: (patch.repeat ?? 'all') as 'off' | 'all' | 'one',
  shuffle: patch.shuffle ?? false,
  order: [],
}))
const sendCommand = vi.fn(async (_command: unknown) => sampleState())
const subscribeState = vi.fn((onState: (state: SpeakerState) => void, onStatus: (open: boolean) => void) => {
  emitState.current = onState
  onStatus(true)
  return () => undefined
})

vi.mock('@/api', () => ({
  fetchConfig: () => fetchConfig(),
  listPresets: () => listPresets(),
  fetchQueue: () => fetchQueue(),
  setQueueMode: (patch: { repeat?: string; shuffle?: boolean }) => setQueueMode(patch),
  playQueue: vi.fn(async () => ({ items: [], activeIndex: null, repeat: 'off', shuffle: false, order: [] })),
  subscribeState: (onState: (state: SpeakerState) => void, onStatus: (open: boolean) => void) => subscribeState(onState, onStatus),
  sendCommand: (command: unknown) => sendCommand(command as never),
  playStream: vi.fn(async () => sampleState()),
  savePreset: vi.fn(),
  clearPreset: vi.fn(),
  getSleep: vi.fn(async () => ({ endsAt: null })),
  startSleep: vi.fn(async () => ({ endsAt: null })),
  cancelSleep: vi.fn(async () => ({ endsAt: null })),
}))

function sampleState(): SpeakerState {
  const base = emptySpeakerState()
  return {
    ...base,
    connected: true,
    device: {
      host: '192.168.1.100',
      name: 'Office',
      model: 'AudioPro_C10',
      firmware: '4.2.337151',
      uuid: '0123456789ABCDEF',
    },
    playback: {
      ...base.playback,
      status: 'paused',
      title: 'Track One',
      artist: 'Artist',
      album: 'Album',
      duration: 200,
      position: 10,
      isLive: false,
      url: 'http://192.168.1.135:8787/api/library/file?library=main&path=a.mp3',
    },
    volume: { level: 20, muted: false },
    source: 'Stream',
    input: 'wifi',
    updatedAt: Date.now(),
    error: null,
  }
}

async function mountApp() {
  const wrapper = mount(App)
  await flushPromises()
  emitState.current?.(sampleState())
  await flushPromises()
  return wrapper
}

describe('App', () => {
  it('shows the device and the current track from the state stream', async () => {
    const wrapper = await mountApp()

    expect(wrapper.text()).toContain('Office')
    expect(wrapper.text()).toContain('Track One')
    expect(wrapper.text()).toContain('Artist')
    wrapper.unmount()
  })

  it('sends the toggle command from the transport', async () => {
    const wrapper = await mountApp()

    await wrapper.get('button[aria-label="Play"]').trigger('click')
    await flushPromises()

    expect(sendCommand).toHaveBeenCalledWith({ type: 'toggle' })
    wrapper.unmount()
  })

  it('reflects the queue mode and cycles repeat', async () => {
    const wrapper = await mountApp()
    const repeat = wrapper.get('button[aria-label="Repeat all, press to change"]')

    await repeat.trigger('click')
    await flushPromises()

    expect(setQueueMode).toHaveBeenCalledWith({ repeat: 'one' })
    expect(wrapper.find('button[aria-label="Repeat one, press to change"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
