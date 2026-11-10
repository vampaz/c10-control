import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeakerDevice } from '../server/device.ts'

const CONFIG = {
  host: '192.168.1.100',
  httpPort: 80,
  upnpPort: 49152,
  libraries: [],
  browseRoots: [],
  mediaBaseUrl: '',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SpeakerDevice device details', () => {
  const SOAP = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">'
    + '<s:Body><u:GetControlDeviceInfoResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">'
    + '<MultiType>1</MultiType>'
    + '<Status>{ &quot;DeviceName&quot;: &quot;Office&quot;, &quot;RSSI&quot;: &quot;-44&quot;, &quot;WifiChannel&quot;: &quot;9&quot;, &quot;internet&quot;: &quot;1&quot;, &quot;VersionUpdate&quot;: &quot;0&quot; }</Status>'
    + '</u:GetControlDeviceInfoResponse></s:Body></s:Envelope>'

  it('parses the escaped device status JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(SOAP, { status: 200 })))

    const details = await new SpeakerDevice(CONFIG).getDeviceDetails()

    expect(details).toMatchObject({
      DeviceName: 'Office',
      RSSI: '-44',
      WifiChannel: '9',
      internet: '1',
      VersionUpdate: '0',
    })
  })

  it('sends the new device name', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''))
      return new Response('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
        + '<u:SetDeviceNameResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"/>'
        + '</s:Body></s:Envelope>', { status: 200 })
    }))

    await new SpeakerDevice(CONFIG).setDeviceName('Kitchen')

    expect(bodies[0]).toContain('<Name>Kitchen</Name>')
    expect(bodies[0]).toContain('SetDeviceName')
  })
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
