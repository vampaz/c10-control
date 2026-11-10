import { describe, expect, it } from 'vitest'
import { detectMediaBaseUrl, localAddressFor, localAddresses } from '../server/network.ts'

describe('network helpers', () => {
  it('returns only real IPv4 addresses', () => {
    for (const address of localAddresses()) {
      expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/)
      expect(address.startsWith('127.')).toBe(false)
    }
  })

  it.skipIf(localAddresses().length === 0)('prefers an address on the speaker subnet', () => {
    const address = localAddressFor('192.168.1.100')

    expect(localAddresses()).toContain(address)
  })

  it('uses the configured media URL when one is set', () => {
    expect(detectMediaBaseUrl('192.168.1.100', 5173, ' http://media.local:9000/ ')).toBe('http://media.local:9000')
  })

  it.skipIf(localAddresses().length === 0)('falls back to a detected address and the app port', () => {
    const base = detectMediaBaseUrl('192.168.1.100', 5173)

    expect(base).toMatch(/^http:\/\/\d{1,3}(\.\d{1,3}){3}:5173$/)
  })
})
