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

  async function run(command: CommandRequest): Promise<void> {
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
