// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { PlayTarget } from '@shared/types'
import PresetBar from '@/components/PresetBar.vue'

const TARGET: PlayTarget = {
  url: 'http://proic1.redeaudio.com/oxigenio_aac',
  title: 'Rádio Oxigénio',
  artworkUrl: null,
  isLive: true,
}

function slots(filled: number | null = null): (PlayTarget | null)[] {
  return Array.from({ length: 6 }, (_, index) => (index === filled ? TARGET : null))
}

describe('PresetBar', () => {
  it('renders six slots', () => {
    const wrapper = mount(PresetBar, { props: { presets: slots(), current: TARGET, busy: false } })

    expect(wrapper.findAll('.slot')).toHaveLength(6)
    expect(wrapper.text()).toContain('Set')
    wrapper.unmount()
  })

  it('saves the current track into an empty slot', async () => {
    const wrapper = mount(PresetBar, { props: { presets: slots(), current: TARGET, busy: false } })

    await wrapper.findAll('.slot-main')[2].trigger('click')

    expect(wrapper.emitted('save')).toEqual([[2]])
    wrapper.unmount()
  })

  it('disables empty slots when nothing is playing', () => {
    const wrapper = mount(PresetBar, { props: { presets: slots(), current: null, busy: false } })

    const empty = wrapper.findAll('.slot-main')[0]
    expect((empty.element as HTMLButtonElement).disabled).toBe(true)
    expect(empty.classes()).toContain('unavailable')
    wrapper.unmount()
  })

  it('does not dim empty slots while a command is busy', () => {
    const wrapper = mount(PresetBar, { props: { presets: slots(), current: TARGET, busy: true } })

    const empty = wrapper.findAll('.slot-main')[2]
    expect((empty.element as HTMLButtonElement).disabled).toBe(true)
    expect(empty.classes()).not.toContain('unavailable')
    wrapper.unmount()
  })

  it('plays a filled slot', async () => {
    const wrapper = mount(PresetBar, { props: { presets: slots(1), current: null, busy: false } })

    await wrapper.findAll('.slot-main')[1].trigger('click')

    expect(wrapper.emitted('play')).toEqual([[TARGET]])
    expect(wrapper.text()).toContain('Rádio Oxigénio')
    wrapper.unmount()
  })

  it('clears a filled slot', async () => {
    const wrapper = mount(PresetBar, { props: { presets: slots(3), current: null, busy: false } })

    await wrapper.findAll('.slot-clear')[0].trigger('click')

    expect(wrapper.emitted('clear')).toEqual([[3]])
    wrapper.unmount()
  })
})
