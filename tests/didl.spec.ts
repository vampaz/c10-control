import { describe, expect, it } from 'vitest'
import { buildDidl, guessMime } from '../server/didl.ts'

describe('guessMime', () => {
  it('reads the extension from the URL path', () => {
    expect(guessMime('http://host/music/song.flac')).toBe('audio/flac')
    expect(guessMime('http://host/music/song.aac?token=1')).toBe('audio/aac')
  })

  it('defaults to MPEG audio for streams', () => {
    expect(guessMime('http://host/live')).toBe('audio/mpeg')
    expect(guessMime('not a url')).toBe('audio/mpeg')
  })
})

describe('buildDidl', () => {
  const metadata = buildDidl({
    url: 'http://stream.example.com/live.mp3',
    title: 'Radio & Test',
    artworkUrl: 'http://cdn.example.com/logo.png?a=1&b=2',
  })

  it('describes a live stream as a broadcast', () => {
    expect(metadata).toContain('<upnp:class>object.item.audioItem.audioBroadcast</upnp:class>')
  })

  it('describes a finite track as a music track', () => {
    const track = buildDidl({ url: 'http://host/song.mp3', title: 'Song', isLive: false })
    expect(track).toContain('<upnp:class>object.item.audioItem.musicTrack</upnp:class>')
  })

  it('includes the title, artwork and resource', () => {
    expect(metadata).toContain('<dc:title>Radio &amp; Test</dc:title>')
    expect(metadata).toContain('<upnp:albumArtURI>http://cdn.example.com/logo.png?a=1&amp;b=2</upnp:albumArtURI>')
    expect(metadata).toContain('protocolInfo="http-get:*:audio/mpeg:*"')
    expect(metadata).toContain('>http://stream.example.com/live.mp3</res>')
  })

  it('falls back to the URL as the title', () => {
    const untitled = buildDidl({ url: 'http://host/live' })
    expect(untitled).toContain('<dc:title>http://host/live</dc:title>')
    expect(untitled).not.toContain('<upnp:albumArtURI>')
  })

  it('includes the artist and album when given', () => {
    const track = buildDidl({ url: 'http://host/song.mp3', title: 'Song', artist: 'Artist & Band', album: 'Record', isLive: false })
    expect(track).toContain('<dc:creator>Artist &amp; Band</dc:creator>')
    expect(track).toContain('<upnp:album>Record</upnp:album>')
  })

  it('omits the artist and album when absent', () => {
    const track = buildDidl({ url: 'http://host/song.mp3', title: 'Song', isLive: false })
    expect(track).not.toContain('<dc:creator>')
    expect(track).not.toContain('<upnp:album>')
  })
})
