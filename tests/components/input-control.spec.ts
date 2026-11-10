// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { SpeakerInput } from '@shared/types'
import InputControl from '@/components/InputControl.vue'

function mountControl(current: SpeakerInput | null = 'wifi') {
  return mount(InputControl, { props: { current, busy: false } })
}

describe('InputControl', () => {
  it('offers the four inputs', () => {
    const wrapper = mountControl()

    expect(wrapper.findAll('.options button')).toHaveLength(4)
    expect(wrapper.text()).toContain('Wi-Fi')
    expect(wrapper.text()).toContain('Bluetooth')
    expect(wrapper.text()).toContain('Aux')
    expect(wrapper.text()).toContain('Optical')
    wrapper.unmount()
  })

  it('marks the current input', () => {
    const wrapper = mountControl('bluetooth')
    const buttons = wrapper.findAll('.options button')

    expect(buttons[1].attributes('aria-pressed')).toBe('true')
    expect(buttons[0].attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('emits the chosen input', async () => {
    const wrapper = mountControl()

    await wrapper.findAll('.options button')[2].trigger('click')

    expect(wrapper.emitted('input')).toEqual([['line-in']])
    wrapper.unmount()
  })

  it('disables the buttons while busy', () => {
    const wrapper = mount(InputControl, { props: { current: 'wifi', busy: true } })

    expect((wrapper.get('.options button').element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
  })
})
