import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRESET_COUNT, PresetStore } from '../server/presets.ts'

const TARGET = {
  url: 'http://proic1.redeaudio.com/oxigenio_aac',
  title: 'Rádio Oxigénio',
  artworkUrl: 'https://example.com/logo.jpg',
  isLive: true,
}

function store(): PresetStore {
  return new PresetStore(mkdtempSync(join(tmpdir(), 'c10-presets-')))
}

describe('PresetStore', () => {
  it('starts with six empty slots', () => {
    expect(store().list()).toEqual(Array.from({ length: PRESET_COUNT }, () => null))
  })

  it('saves a target in its slot and persists it', () => {
    const presets = store()
    const saved = presets.save(2, TARGET)

    expect(saved[2]).toEqual({ ...TARGET })
    expect(presets.list()[2]).toEqual({ ...TARGET })
  })

  it('keeps other slots untouched', () => {
    const presets = store()
    presets.save(0, TARGET)
    presets.save(3, { ...TARGET, title: 'FIP Jazz', url: 'http://example.com/jazz.aac' })

    const slots = presets.list()
    expect(slots[0]?.title).toBe('Rádio Oxigénio')
    expect(slots[3]?.title).toBe('FIP Jazz')
    expect(slots[1]).toBeNull()
  })

  it('clears one slot', () => {
    const presets = store()
    presets.save(1, TARGET)

    expect(presets.clear(1)[1]).toBeNull()
  })

  it('rejects an invalid slot index', () => {
    const presets = store()
    expect(() => presets.save(PRESET_COUNT, TARGET)).toThrow('Preset index')
    expect(() => presets.save(-1, TARGET)).toThrow('Preset index')
  })

  it('rejects a target that is not an http URL', () => {
    expect(() => store().save(0, { ...TARGET, url: 'file:///etc/passwd' })).toThrow('http or https')
  })

  it('writes a readable file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'c10-presets-'))
    new PresetStore(directory).save(0, TARGET)

    const stored = JSON.parse(readFileSync(join(directory, 'presets.json'), 'utf8')) as unknown[]
    expect(stored[0]).toMatchObject({ title: 'Rádio Oxigénio' })
  })
})
