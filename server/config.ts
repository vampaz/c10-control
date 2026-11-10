import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { AppConfig, LibraryRoot } from '../shared/types.ts'

const DEFAULT_CONFIG: AppConfig = {
  host: '192.168.1.100',
  httpPort: 80,
  upnpPort: 49152,
  libraries: [],
  browseRoots: [],
  mediaBaseUrl: '',
}

const HOST_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/
const MAX_LIBRARIES = 20
const MAX_BROWSE_ROOTS = 20

export function getDataDirectory(): string {
  return process.env.C10_DATA_DIR ?? join(import.meta.dirname, '..', '.data')
}

function configPath(): string {
  return join(getDataDirectory(), 'config.json')
}

/** Stable id for a library, based on its absolute path. */
export function libraryId(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 12)
}

function expandPath(value: string): string {
  if (value === '~') {
    return homedir()
  }
  if (value.startsWith('~/')) {
    return join(homedir(), value.slice(2))
  }
  return value ? resolve(value) : ''
}

function normalisePaths(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const paths: string[] = []

  for (const entry of input) {
    const path = expandPath(String(entry ?? '').trim())
    if (!path || seen.has(path)) {
      continue
    }
    seen.add(path)
    paths.push(path)
    if (paths.length >= MAX_BROWSE_ROOTS) {
      break
    }
  }

  return paths
}

function normaliseLibraries(input: unknown): LibraryRoot[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const libraries: LibraryRoot[] = []

  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const raw = entry as Record<string, unknown>
    const path = expandPath(String(raw.path ?? '').trim())
    if (!path || seen.has(path)) {
      continue
    }

    seen.add(path)
    libraries.push({
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : libraryId(path),
      name: String(raw.name ?? '').trim().slice(0, 80) || basename(path) || 'Music',
      path,
    })

    if (libraries.length >= MAX_LIBRARIES) {
      break
    }
  }

  return libraries
}

/** Deployment configuration from the environment, which wins over the saved file. */
function environmentConfig(): Partial<AppConfig> {
  const fromEnvironment: Partial<AppConfig> = {}

  if (process.env.C10_HOST) {
    fromEnvironment.host = process.env.C10_HOST.trim()
  }
  if (process.env.C10_HTTP_PORT) {
    fromEnvironment.httpPort = Number(process.env.C10_HTTP_PORT)
  }
  if (process.env.C10_UPNP_PORT) {
    fromEnvironment.upnpPort = Number(process.env.C10_UPNP_PORT)
  }

  const directories = [
    process.env.C10_LIBRARY_DIR,
    ...(process.env.C10_LIBRARY_DIRS ?? '').split(','),
  ]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)

  if (directories.length) {
    fromEnvironment.libraries = normaliseLibraries(directories.map((path) => ({ path })))
  }
  if (process.env.C10_BROWSE_ROOTS) {
    fromEnvironment.browseRoots = normalisePaths(process.env.C10_BROWSE_ROOTS.split(','))
  }
  if (process.env.C10_MEDIA_URL) {
    fromEnvironment.mediaBaseUrl = process.env.C10_MEDIA_URL.trim()
  }

  return fromEnvironment
}

export type ConfigPatch = Omit<Partial<AppConfig>, 'libraries'> & { libraries?: unknown }

export function validateConfig(patch: ConfigPatch): Partial<AppConfig> {
  const clean: Partial<AppConfig> = {}

  if (patch.host !== undefined) {
    const host = String(patch.host).trim()
    if (!HOST_PATTERN.test(host)) {
      throw new Error('Enter a valid IP address or host name')
    }
    clean.host = host
  }

  for (const key of ['httpPort', 'upnpPort'] as const) {
    const value = patch[key]
    if (value === undefined) {
      continue
    }
    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${key} must be a port between 1 and 65535`)
    }
    clean[key] = port
  }

  if (patch.libraries !== undefined) {
    clean.libraries = normaliseLibraries(patch.libraries)
  }

  if (patch.browseRoots !== undefined) {
    clean.browseRoots = normalisePaths(patch.browseRoots)
  }

  if (patch.mediaBaseUrl !== undefined) {
    const base = String(patch.mediaBaseUrl).trim().replace(/\/+$/, '')
    if (base && !/^https?:\/\/\S+$/i.test(base)) {
      throw new Error('The media URL must start with http:// or https://')
    }
    clean.mediaBaseUrl = base
  }

  return clean
}

function readStoredConfig(): Partial<AppConfig> {
  try {
    const stored = JSON.parse(readFileSync(configPath(), 'utf8')) as Record<string, unknown>
    // Migrate the single-folder format from older versions.
    if (!Array.isArray(stored.libraries) && typeof stored.libraryDir === 'string' && stored.libraryDir.trim()) {
      stored.libraries = [{ path: stored.libraryDir }]
    }
    delete stored.libraryDir
    return validateConfig(stored as ConfigPatch)
  } catch {
    return {}
  }
}

export function loadConfig(): AppConfig {
  const fromEnvironment = environmentConfig()

  return {
    ...DEFAULT_CONFIG,
    ...readStoredConfig(),
    ...fromEnvironment,
    // The settings dialog shows the address as read-only while C10_HOST is set.
    pinnedHost: fromEnvironment.host !== undefined,
  }
}

export function saveConfig(patch: ConfigPatch): AppConfig {
  const clean = validateConfig(patch)
  const current = loadConfig()

  if (current.pinnedHost && clean.host !== undefined && clean.host !== current.host) {
    throw new Error('The address is set by C10_HOST in the environment')
  }

  const persisted = { ...readStoredConfig(), ...clean }
  mkdirSync(getDataDirectory(), { recursive: true })
  writeFileSync(configPath(), `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')

  return loadConfig()
}
