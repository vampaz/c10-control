import { describe, expect, it } from 'vitest'
import { parseMediaInfo } from '../server/mediainfo.ts'

function envelope(uri: string, didl: string): string {
  const escaped = didl
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  return [
    '<?xml version="1.0"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">',
    '<s:Body><u:GetMediaInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">',
    '<NrTracks>1</NrTracks>',
    `<CurrentURI>${uri}</CurrentURI>`,
    `<CurrentURIMetaData>${escaped}</CurrentURIMetaData>`,
    '</u:GetMediaInfoResponse></s:Body></s:Envelope>',
  ].join('')
}

describe('parseMediaInfo', () => {
  it('reads the TuneIn metadata the speaker returns for a live station', () => {
    const didl = [
      '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"',
      ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"',
      ' xmlns:song="www.wiimu.com/song/">',
      '<item id="0">',
      '<song:isLive>1</song:isLive>',
      '<res protocolInfo="http-get:*:audio/mpeg:DLNA.ORG_PN=MP3" duration="">unknown</res>',
      '<dc:title>Rádio Oxigénio</dc:title>',
      '<dc:subtitle>Música para Respirar</dc:subtitle>',
      '<upnp:albumArtURI>https://example.com/logo.jpg?t=1</upnp:albumArtURI>',
      '</item></DIDL-Lite>',
    ].join('')

    const info = parseMediaInfo(envelope('http://proic1.redeaudio.com/oxigenio_aac', didl))

    expect(info).toEqual({
      url: 'http://proic1.redeaudio.com/oxigenio_aac',
      title: 'Rádio Oxigénio',
      subtitle: 'Música para Respirar',
      artworkUrl: 'https://example.com/logo.jpg?t=1',
      isLive: true,
    })
  })

  it('marks a finite track as not live and decodes escaped URLs', () => {
    const didl = [
      '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"',
      ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"',
      ' xmlns:song="www.wiimu.com/song/">',
      '<item id="0">',
      '<song:isLive>0</song:isLive>',
      '<res duration="00:03:12">http://example.com/a.mp3</res>',
      '<dc:title>Track &amp; Field</dc:title>',
      '<upnp:albumArtURI>https://example.com/cover.jpg?a=1&amp;b=2</upnp:albumArtURI>',
      '</item></DIDL-Lite>',
    ].join('')

    const info = parseMediaInfo(envelope('http://example.com/a.mp3', didl))

    expect(info.isLive).toBe(false)
    expect(info.title).toBe('Track & Field')
    expect(info.artworkUrl).toBe('https://example.com/cover.jpg?a=1&b=2')
  })

  it('returns an empty result when the speaker has no media', () => {
    const info = parseMediaInfo(envelope('unknown', ''))

    expect(info.url).toBe('')
    expect(info.title).toBe('')
    expect(info.artworkUrl).toBeNull()
    expect(info.isLive).toBe(true)
  })

  it('rejects artwork that is not an http URL', () => {
    const didl = '<DIDL-Lite><item><upnp:albumArtURI>file:///cover.jpg</upnp:albumArtURI></item></DIDL-Lite>'
    expect(parseMediaInfo(envelope('http://example.com/a.mp3', didl)).artworkUrl).toBeNull()
  })
})
