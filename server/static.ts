import { createReadStream, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function resolveFile(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // Malformed percent encoding in the request path.
    return null
  }

  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(root, `.${sep}${relative}`)
  if (!candidate.startsWith(root)) {
    return null
  }

  try {
    return statSync(candidate).isFile() ? candidate : null
  } catch {
    return null
  }
}

function pipeFile(path: string, response: ServerResponse): void {
  const type = MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const immutable = path.includes(`${sep}assets${sep}`)
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(path).pipe(response)
}

/** Serves the built UI, falling back to index.html for client side routes. */
export function serveStatic(root: string, pathname: string, response: ServerResponse): boolean {
  const file = resolveFile(root, pathname)
  if (file) {
    pipeFile(file, response)
    return true
  }

  if (extname(pathname)) {
    return false
  }

  const index = join(root, 'index.html')
  if (resolveFile(root, '/index.html')) {
    pipeFile(index, response)
    return true
  }

  return false
}
