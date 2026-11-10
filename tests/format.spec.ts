import { describe, expect, it } from 'vitest'
import { artworkStyle, formatTime, hashString, prettyModel, titleForUrl } from '../src/format.ts'

describe('formatTime', () => {
  it('formats minutes and seconds', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9)).toBe('0:09')
    expect(formatTime(61)).toBe('1:01')
    expect(formatTime(599)).toBe('9:59')
  })

  it('adds hours when needed', () => {
    expect(formatTime(3661)).toBe('1:01:01')
  })

  it('guards against invalid input', () => {
    expect(formatTime(-4)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})

describe('artworkStyle', () => {
  it('is stable for the same seed', () => {
    expect(artworkStyle('Rádio Oxigénio|unknown')).toEqual(artworkStyle('Rádio Oxigénio|unknown'))
  })

  it('differs between tracks', () => {
    expect(artworkStyle('one')).not.toEqual(artworkStyle('two'))
  })

  it('produces a background gradient', () => {
    expect(artworkStyle('x').background).toContain('radial-gradient')
  })
})

describe('hashString', () => {
  it('is deterministic and non negative', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).toBeGreaterThanOrEqual(0)
  })
})

describe('prettyModel', () => {
  it('turns the firmware project id into a product name', () => {
    expect(prettyModel('AudioPro_C10')).toBe('Audio Pro C10')
  })

  it('falls back to the product name', () => {
    expect(prettyModel(undefined)).toBe('Audio Pro C10')
  })
})

describe('titleForUrl', () => {
  it('uses the file name when the URL points at a file', () => {
    expect(titleForUrl('http://host/music/Album/song.mp3')).toBe('song.mp3')
  })

  it('uses the host name for extensionless streams', () => {
    expect(titleForUrl('http://proic1.redeaudio.com/oxigenio_aac')).toBe('proic1.redeaudio.com')
    expect(titleForUrl('https://stream.example.com/live/')).toBe('stream.example.com')
  })

  it('keeps unparseable input', () => {
    expect(titleForUrl('not a url')).toBe('not a url')
  })
})
