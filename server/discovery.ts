import { createSocket } from 'node:dgram'
import type { DiscoveredDevice } from '../shared/types.ts'

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1900
const SEARCH_TARGET = 'urn:schemas-upnp-org:device:MediaRenderer:1'

function field(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? match[1].trim() : ''
}

async function describe(location: string): Promise<DiscoveredDevice | null> {
  try {
    const response = await fetch(location, { signal: AbortSignal.timeout(2000) })
    if (!response.ok) {
      return null
    }
    const xml = await response.text()
    if (!xml.includes(':device:MediaRenderer:1')) {
      return null
    }

    const url = new URL(location)
    return {
      host: url.hostname,
      name: field(xml, 'friendlyName') || url.hostname,
      model: field(xml, 'modelName') || 'MediaRenderer',
      location,
    }
  } catch {
    return null
  }
}

/**
 * Finds MediaRenderers on the local network with an SSDP M-SEARCH probe.
 * The speaker answers in about a second, so a short window is enough.
 */
export function discoverDevices(timeoutMs = 2500): Promise<DiscoveredDevice[]> {
  return new Promise((resolve) => {
    const locations = new Set<string>()
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    let probe: ReturnType<typeof setInterval> | null = null
    let done = false

    const message = [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 2',
      `ST: ${SEARCH_TARGET}`,
      '',
      '',
    ].join('\r\n')

    async function finish(): Promise<void> {
      if (done) {
        return
      }
      done = true
      if (probe) {
        clearInterval(probe)
        probe = null
      }
      socket.close()

      const descriptions = await Promise.all([...locations].map(describe))
      resolve(descriptions.filter((device): device is DiscoveredDevice => device !== null))
    }

    socket.on('message', (payload) => {
      const location = /^location:\s*(.+)$/im.exec(payload.toString('utf8'))
      if (location) {
        locations.add(location[1].trim())
      }
    })
    socket.on('error', () => void finish())

    socket.bind(() => {
      const send = (): void => {
        socket.send(message, SSDP_PORT, SSDP_ADDRESS, () => undefined)
      }
      send()
      probe = setInterval(send, 500)
      setTimeout(() => void finish(), timeoutMs)
    })
  })
}
