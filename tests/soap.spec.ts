import { describe, expect, it } from 'vitest'
import {
  buildSoapEnvelope,
  parseSoapFault,
  parseSoapResponse,
  unescapeXml,
} from '../server/soap.ts'

const VOLUME_RESPONSE = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>
<u:GetVolumeResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
<CurrentVolume>4</CurrentVolume>
</u:GetVolumeResponse>
</s:Body> </s:Envelope>`

const FAULT_RESPONSE = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>
<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring>
<detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0">
<errorCode>701</errorCode><errorDescription>Transition not available</errorDescription>
</UPnPError></detail></s:Fault></s:Body></s:Envelope>`

describe('buildSoapEnvelope', () => {
  it('wraps the action with the service namespace and arguments', () => {
    const envelope = buildSoapEnvelope({
      service: 'urn:schemas-upnp-org:service:RenderingControl:1',
      action: 'SetVolume',
      args: { Channel: 'Master', DesiredVolume: 42 },
    })

    expect(envelope).toContain('<u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">')
    expect(envelope).toContain('<InstanceID>0</InstanceID>')
    expect(envelope).toContain('<Channel>Master</Channel><DesiredVolume>42</DesiredVolume>')
    expect(envelope).toContain('</u:SetVolume>')
  })

  it('escapes argument values', () => {
    const envelope = buildSoapEnvelope({
      service: 'svc',
      action: 'SetAVTransportURI',
      args: { CurrentURIMetaData: '<a&b>' },
    })

    expect(envelope).toContain('&lt;a&amp;b&gt;')
    expect(envelope).not.toContain('<a&b>')
  })
})

describe('parseSoapResponse', () => {
  it('reads the direct children of the response element', () => {
    expect(parseSoapResponse(VOLUME_RESPONSE)).toEqual({ CurrentVolume: '4' })
  })

  it('returns an empty object when there is no response element', () => {
    expect(parseSoapResponse('<html>nope</html>')).toEqual({})
  })
})

describe('parseSoapFault', () => {
  it('extracts code and description', () => {
    expect(parseSoapFault(FAULT_RESPONSE)).toEqual({
      code: 701,
      description: 'Transition not available',
    })
  })

  it('returns null for a successful response', () => {
    expect(parseSoapFault(VOLUME_RESPONSE)).toBeNull()
  })
})

describe('unescapeXml', () => {
  it('decodes named and numeric entities', () => {
    expect(unescapeXml('a&amp;b &#65; &#x42; &quot;c&quot;')).toBe('a&b A B "c"')
  })
})
