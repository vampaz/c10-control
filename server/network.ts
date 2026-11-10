import { networkInterfaces } from 'node:os'

/** IPv4 addresses of this machine that are not loopback or link-local. */
export function localAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        addresses.push(entry.address)
      }
    }
  }
  return addresses
}

function subnetOf(address: string): string {
  return address.split('.').slice(0, 3).join('.')
}

/**
 * Picks the local address the speaker can reach. Prefer an interface on the
 * speaker's own subnet, so a VPN or a second network does not win.
 */
export function localAddressFor(host: string): string | null {
  const addresses = localAddresses()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const sameSubnet = addresses.find((address) => subnetOf(address) === subnetOf(host))
    if (sameSubnet) {
      return sameSubnet
    }
  }
  return addresses[0] ?? null
}

/** The base URL the speaker should use for local files. */
export function detectMediaBaseUrl(host: string, port: number, override = ''): string {
  const configured = override.trim().replace(/\/+$/, '')
  if (configured) {
    return configured
  }

  const address = localAddressFor(host)
  return address ? `http://${address}:${port}` : `http://localhost:${port}`
}
