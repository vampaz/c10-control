import type { Server } from 'node:http'
import type { AppConfig } from '../shared/types.ts'
import { createRequestHandler } from './app.ts'
import { getDataDirectory, loadConfig, saveConfig } from './config.ts'
import { SpeakerDevice } from './device.ts'
import { FavoriteStore } from './favorites.ts'
import { FolderBrowser } from './folders.ts'
import { LibraryService } from './library.ts'
import { PlaylistStore } from './playlists.ts'
import { PresetStore } from './presets.ts'
import { QueueController } from './queue.ts'
import { searchStations } from './radio.ts'
import { SleepTimer } from './sleep.ts'
import { SpeakerPoller } from './state.ts'

export interface Runtime {
  config: AppConfig
  handler: ReturnType<typeof createRequestHandler>
}

/**
 * Wires the API to one poller and one speaker client. Both entry points use it
 * so the config-change behaviour stays identical in dev and production.
 */
export function createRuntime(port = Number(process.env.PORT ?? 8787)): Runtime {
  const config = loadConfig()
  const poller = new SpeakerPoller(new SpeakerDevice(config))
  const favorites = new FavoriteStore(getDataDirectory())
  const presets = new PresetStore(getDataDirectory())
  const playlists = new PlaylistStore(getDataDirectory())
  const library = new LibraryService(loadConfig, port)
  library.warmup()
  const folders = new FolderBrowser(loadConfig)
  const queue = new QueueController((target) => poller.playTarget(target))
  poller.onState = (state) => void queue.onState(state)
  const sleep = new SleepTimer({
    getVolume: () => poller.current.volume.level,
    setVolume: (level) => poller.run({ type: 'volume', value: level }),
    pause: () => poller.run({ type: 'pause' }),
  })

  const handler = createRequestHandler({
    poller,
    getConfig: loadConfig,
    setConfig: saveConfig,
    onConfigChange: (next: AppConfig) => poller.useDevice(new SpeakerDevice(next)),
    favorites,
    presets,
    playlists,
    library,
    folders,
    queue,
    sleep,
    searchRadio: searchStations,
  })

  return { config, handler }
}

/**
 * Event streams keep sockets open, so they are closed before the server is
 * asked to stop.
 */
export function stopOnSignals(server: Server, closeExtra?: () => Promise<unknown>): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.closeAllConnections()
      server.close(() => process.exit(0))
      void closeExtra?.()
    })
  }
}
