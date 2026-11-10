// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QueueModes from '@/components/QueueModes.vue'

function mountModes(repeat: 'off' | 'all' | 'one' = 'off', shuffle = false) {
  return mount(QueueModes, { props: { repeat, shuffle } })
}

describe('QueueModes', () => {
  it('cycles repeat from off to all to one to off', async () => {
    const wrapper = mountModes()

    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.emitted('repeat')?.at(-1)).toEqual(['all'])

    await wrapper.setProps({ repeat: 'all' })
    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.emitted('repeat')?.at(-1)).toEqual(['one'])

    await wrapper.setProps({ repeat: 'one' })
    await wrapper.findAll('button')[0].trigger('click')
    expect(wrapper.emitted('repeat')?.at(-1)).toEqual(['off'])
  })

  it('toggles shuffle', async () => {
    const wrapper = mountModes('off', false)

    await wrapper.findAll('button')[1].trigger('click')

    expect(wrapper.emitted('shuffle')?.[0]).toEqual([true])
  })

  it('marks the active modes and labels repeat one', () => {
    const wrapper = mountModes('one', true)

    expect(wrapper.findAll('button')[0].attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('button')[1].attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('Repeat one')
  })
})
