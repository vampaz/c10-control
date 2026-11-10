import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { AppConfig, FolderEntry, FolderListing } from '../shared/types.ts'

const MAX_FOLDERS = 500

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

/** Lists directories under the configured browse roots, read-only. */
export class FolderBrowser {
  private readonly getConfig: () => AppConfig

  constructor(getConfig: () => AppConfig) {
    this.getConfig = getConfig
  }

  async listing(requestedPath: string): Promise<FolderListing> {
    const roots = this.getConfig().browseRoots
    if (!roots.length) {
      return { path: '', parent: null, roots: [], folders: [] }
    }

    const readable = (await Promise.all(roots.map(async (root) => {
      const real = await realpath(root).catch(() => null)
      return real ? { root, real } : null
    }))).filter((entry): entry is { root: string; real: string } => entry !== null)

    if (!readable.length) {
      throw new Error('No browse roots are readable')
    }

    const requested = resolve(requestedPath.trim() || readable[0].real)
    const target = await realpath(requested).catch(() => null)
    if (!target) {
      throw new Error('Folder not found')
    }

    const match = readable.find(({ real }) => isInside(real, target))
    if (!match) {
      throw new Error('Folder is outside the allowed browse roots')
    }

    const stats = await stat(target).catch(() => null)
    if (!stats?.isDirectory()) {
      throw new Error('Not a folder')
    }

    const entries = await readdir(target, { withFileTypes: true }).catch(() => [])
    const folders: FolderEntry[] = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: join(target, entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_FOLDERS)

    const parent = target === match.real ? null : dirname(target)

    return {
      path: target,
      parent: parent && isInside(match.real, parent) ? parent : null,
      roots: readable.map((entry) => entry.real),
      folders,
    }
  }
}
