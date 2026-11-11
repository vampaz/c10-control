import { log } from './log.ts'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createRuntime, stopOnSignals } from './runtime.ts'
import { serveStatic } from './static.ts'

const PORT = Number(process.env.PORT ?? 8787)
const DIST = join(import.meta.dirname, '..', 'dist')

const { config, handler } = createRuntime(PORT)

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname

  if (pathname.startsWith('/api/')) {
    void handler(request, response)
    return
  }

  if (!serveStatic(DIST, pathname, response, request.headers['accept-encoding'])) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found. Run `npm run build` first.')
  }
})

server.listen(PORT, () => {
  log(`C10 Control running at http://localhost:${PORT}`)
  log(`Controlling speaker at ${config.host}:${config.httpPort}`)
})

stopOnSignals(server)
