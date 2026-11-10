import { describe, expect, it } from 'vitest'
import { decodeText, inputFromMode, modeLabel, parsePlayerStatus, parsePlayerStatusPayload } from '../server/status.ts'

const LIVE_PAYLOAD = '{"type":"0","ch":"0","mode":"10","loop":"0","eq":"0","status":"play","curpos":"264340","offset_pts":"264340","totlen":"0","Title":"52C3A164696F204F786967C3A96E696F","Artist":"unknown","Album":"unknown","alarmflag":"0","plicount":"1","plicurr":"1","vol":"4","mute":"0"}'

describe('decodeText', () => {
  it('decodes hex encoded UTF-8', () => {
    expect(decodeText('52C3A164696F204F786967C3A96E696F')).toBe('Rádio Oxigénio')
  })

  it('unescapes XML entities that the speaker echoes back', () => {
    expect(decodeText('4169722D30312D4C612046656D6D6520642661706F733B417267656E74')).toBe("Air-01-La Femme d'Argent")
    expect(decodeText('Rock &amp; Roll')).toBe('Rock & Roll')
    expect(decodeText('Air d&apos;Argent')).toBe("Air d'Argent")
  })

  it('keeps plain text intact', () => {
    expect(decodeText('unknown')).toBe('unknown')
    expect(decodeText('Daft Punk')).toBe('Daft Punk')
  })

  it('keeps hex shaped words that are not valid text', () => {
    expect(decodeText('deadbeef')).toBe('deadbeef')
  })

  it('rejects hex that decodes to control characters', () => {
    expect(decodeText('0a0b0c0d')).toBe('0a0b0c0d')
  })

  it('handles missing values', () => {
    expect(decodeText(undefined)).toBe('')
  })
})

describe('modeLabel', () => {
  it('names known modes', () => {
    expect(modeLabel(10)).toBe('Radio')
    expect(modeLabel(2)).toBe('Stream')
    expect(modeLabel(41)).toBe('Bluetooth')
  })

  it('falls back to the raw number', () => {
    expect(modeLabel(77)).toBe('Source 77')
  })
})

describe('inputFromMode', () => {
  it('maps modes to switchable inputs', () => {
    expect(inputFromMode(2)).toBe('wifi')
    expect(inputFromMode(10)).toBe('wifi')
    expect(inputFromMode(40)).toBe('line-in')
    expect(inputFromMode(41)).toBe('bluetooth')
    expect(inputFromMode(43)).toBe('optical')
  })

  it('returns null for modes the app cannot switch to', () => {
    expect(inputFromMode(31)).toBeNull()
  })
})

describe('parsePlayerStatus', () => {
  it('maps a live internet radio stream', () => {
    const status = parsePlayerStatusPayload(LIVE_PAYLOAD)

    expect(status).toEqual({
      status: 'playing',
      mode: 10,
      title: 'Rádio Oxigénio',
      artist: 'unknown',
      album: 'unknown',
      volume: 4,
      muted: false,
      position: 264,
      duration: 0,
      isLive: true,
    })
  })

  it('reads a paused track with a duration', () => {
    const status = parsePlayerStatus({
      status: 'pause',
      totlen: '212000',
      curpos: '61000',
      vol: '37',
      mute: '1',
      Title: '7E',
    })

    expect(status.status).toBe('paused')
    expect(status.duration).toBe(212)
    expect(status.position).toBe(61)
    expect(status.isLive).toBe(false)
    expect(status.muted).toBe(true)
    expect(status.volume).toBe(37)
  })

  it('treats an unknown status as idle', () => {
    expect(parsePlayerStatus({ status: 'jumping' }).status).toBe('idle')
  })

  it('treats a local file reporting "none" as playing', () => {
    const status = parsePlayerStatus({ status: 'none', totlen: '12000', curpos: '1000' })

    expect(status.status).toBe('playing')
    expect(status.duration).toBe(12)
    expect(status.position).toBe(1)
    expect(status.isLive).toBe(false)
  })
})

describe('parsePlayerStatusPayload', () => {
  it('explains a rejected command', () => {
    expect(() => parsePlayerStatusPayload('unknown command')).toThrow('The speaker rejected the status request')
  })

  it('explains an HTML answer', () => {
    expect(() => parsePlayerStatusPayload('<html></html>')).toThrow('Unexpected response from the speaker')
  })
})
