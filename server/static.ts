import { createReadStream, readFileSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

const GZIP_TYPES = new Set(['.html', '.js', '.css'])
/** Compressed bytes keyed by path, validated against the file's mtime and size. */
const gzipCache = new Map<string, { mtimeMs: number; size: number; data: Buffer }>()

/** Returns gzipped bytes for compressible types, or null when compression is not worth it. */
function gzipFile(path: string): Buffer | null {
  if (!GZIP_TYPES.has(extname(path).toLowerCase())) {
    return null
  }

  try {
    const stats = statSync(path)
    const cached = gzipCache.get(path)
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.data
    }

    const data = gzipSync(readFileSync(path))
    gzipCache.set(path, { mtimeMs: stats.mtimeMs, size: stats.size, data })
    return data
  } catch {
    // Fall back to serving the plain file when it cannot be read.
    return null
  }
}

function pipeFile(path: string, response: ServerResponse, acceptEncoding: string | undefined): void {
  const type = MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const immutable = path.includes(`${sep}assets${sep}`)
  const offersGzip = typeof acceptEncoding === 'string' && acceptEncoding.includes('gzip')
  const compressed = offersGzip ? gzipFile(path) : null
  if (compressed) {
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': compressed.byteLength,
      'Content-Encoding': 'gzip',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Vary': 'Accept-Encoding',
    })
    response.end(compressed)
    return
  }
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(path).pipe(response)
}

/** Serves the built UI, falling back to index.html for client side routes. */
export function serveStatic(root: string, pathname: string, response: ServerResponse, acceptEncoding?: string): boolean {
  const file = resolveFile(root, pathname)
  if (file) {
    pipeFile(file, response, acceptEncoding)
    return true
  }

  if (extname(pathname)) {
    return false
  }

  const index = join(root, 'index.html')
  if (resolveFile(root, '/index.html')) {
    pipeFile(index, response, acceptEncoding)
    return true
  }

  return false
}
