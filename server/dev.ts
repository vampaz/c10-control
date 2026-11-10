import { log } from './log.ts'
import { createServer } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { createRuntime, stopOnSignals } from './runtime.ts'

const PORT = Number(process.env.PORT ?? 5173)

const { config, handler } = createRuntime(PORT)

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
})

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname

  if (pathname.startsWith('/api/')) {
    void handler(request, response)
    return
  }

  vite.middlewares(request, response, () => {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  })
})

server.listen(PORT, () => {
  log(`C10 Control dev server at http://localhost:${PORT}`)
  log(`Controlling speaker at ${config.host}:${config.httpPort}`)
})

stopOnSignals(server, () => vite.close())
