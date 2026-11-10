import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeakerDevice } from '../server/device.ts'

const CONFIG = {
  host: '192.168.1.100',
  httpPort: 80,
  upnpPort: 49152,
  libraries: [],
  mediaBaseUrl: '',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SpeakerDevice.switchMode', () => {
  it('sends the firmware input command', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url))
      return new Response('OK', { status: 200 })
    }))

    await new SpeakerDevice(CONFIG).switchMode('bluetooth')

    expect(calls[0]).toContain('/httpapi.asp?command=setPlayerCmd:switchmode:bluetooth')
  })

  it('rejects an input the app does not know', async () => {
    const device = new SpeakerDevice(CONFIG)

    await expect(device.switchMode('hdmi')).rejects.toThrow('Unknown input: hdmi')
  })

  it('surfaces a refusal from the speaker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unknown command', { status: 200 })))

    await expect(new SpeakerDevice(CONFIG).switchMode('optical')).rejects.toThrow('unknown command')
  })
})
