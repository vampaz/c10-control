import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { emptySpeakerState, type CommandRequest, type PlayTarget, type SpeakerState } from '@shared/types'
import { playStream, sendCommand, subscribeState } from '@/api'

export type ConnectionState = 'connecting' | 'live' | 'offline'

export function useSpeaker() {
  const state = ref<SpeakerState>(emptySpeakerState())
  const stream = ref<ConnectionState>('connecting')
  const busy = ref(false)
  const commandError = ref<string | null>(null)

  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = subscribeState(
      (next) => {
        state.value = next
      },
      (open) => {
        stream.value = open ? 'live' : 'offline'
      },
    )
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
  })

  const online = computed(() => state.value.connected)
  const playing = computed(() => state.value.playback.status === 'playing')

  let lastRapidCommandAt = 0
  const RAPID_COMMAND_INTERVAL_MS = 100

  function isRapidCommand(command: CommandRequest): boolean {
    return command.type === 'volume' || command.type === 'seek'
  }

  async function run(command: CommandRequest): Promise<void> {
    if (isRapidCommand(command)) {
      // Keyboard repeat must stay responsive, so volume/seek bypass the busy
      // guard but are throttled to one send per 100 ms.
      const now = Date.now()
      if (now - lastRapidCommandAt < RAPID_COMMAND_INTERVAL_MS) {
        return
      }
      lastRapidCommandAt = now
    } else if (busy.value) {
      return
    }
    busy.value = true
    commandError.value = null
    try {
      state.value = await sendCommand(command)
    } catch (error) {
      commandError.value = error instanceof Error ? error.message : 'The command failed'
    } finally {
      busy.value = false
    }
  }

  async function play(target: PlayTarget): Promise<void> {
    if (busy.value) {
      return
    }
    busy.value = true
    commandError.value = null
    try {
      state.value = await playStream(target)
    } catch (error) {
      commandError.value = error instanceof Error ? error.message : 'The stream could not start'
    } finally {
      busy.value = false
    }
  }

  return { state, stream, busy, commandError, online, playing, run, play }
}
