// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DevicePanel from '@/components/DevicePanel.vue'

const CONFIG = { host: '192.168.1.100', httpPort: 80, upnpPort: 49152, libraries: [], browseRoots: [], mediaBaseUrl: '' }

const DEVICE = {
  host: '192.168.1.100',
  name: 'Office',
  model: 'AudioPro_C10',
  firmware: '4.2.337151',
  uuid: '0123456789ABCDEF01234567',
}

function mountPanel() {
  return mount(DevicePanel, {
    props: { config: CONFIG, device: DEVICE, input: 'wifi' },
    attachTo: document.body,
  })
}

function pressTab(shiftKey = false): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }))
}

describe('DevicePanel', () => {
  it('starts with the address selected', () => {
    const wrapper = mountPanel()
    const input = wrapper.get('input')

    expect(document.activeElement).toBe(input.element)
    wrapper.unmount()
  })

  it('switches the speaker input', async () => {
    const wrapper = mountPanel()
    const buttons = wrapper.findAll('.inputs button')
    const bluetooth = buttons.find((button) => button.text() === 'Bluetooth')

    await bluetooth?.trigger('click')

    expect(wrapper.emitted('input')).toEqual([['bluetooth']])
    wrapper.unmount()
  })

  it('wraps focus from the last control back to the first', () => {
    const wrapper = mountPanel()
    const close = wrapper.get('.dialog-head .icon-button').element as HTMLButtonElement
    const save = wrapper.get('.primary').element as HTMLButtonElement

    save.focus()
    pressTab()

    expect(document.activeElement).toBe(close)
    wrapper.unmount()
  })

  it('wraps backwards from the first control to the last', () => {
    const wrapper = mountPanel()
    const close = wrapper.get('.dialog-head .icon-button').element as HTMLButtonElement
    const save = wrapper.get('.primary').element as HTMLButtonElement

    close.focus()
    pressTab(true)

    expect(document.activeElement).toBe(save)
    wrapper.unmount()
  })

  it('closes on Escape', () => {
    const wrapper = mountPanel()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('shows the address from the current configuration', () => {
    const wrapper = mountPanel()
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('192.168.1.100')
    wrapper.unmount()
  })

  it('explains when Add is clicked without a path', async () => {
    const wrapper = mountPanel()
    const add = wrapper.get('.library-add .ghost')

    await add.trigger('click')

    expect(wrapper.text()).toContain('Enter a folder path first.')
    expect(document.activeElement).toBe(wrapper.findAll('.library-add input')[1].element)
    wrapper.unmount()
  })

  it('adds a folder path to the list', async () => {
    const wrapper = mountPanel()
    const path = wrapper.findAll('.library-add input')[1]

    await path.setValue('/host/music/Album')
    await wrapper.get('.library-add .ghost').trigger('click')

    expect(wrapper.text()).toContain('/host/music/Album')
    wrapper.unmount()
  })

  it('locks the address when the environment pins it but still saves other settings', () => {
    const wrapper = mount(DevicePanel, {
      props: { config: { ...CONFIG, pinnedHost: true }, device: DEVICE },
      attachTo: document.body,
    })

    expect((wrapper.get('input').element as HTMLInputElement).disabled).toBe(true)
    expect((wrapper.get('.primary').element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.text()).toContain('C10_HOST')
    wrapper.unmount()
  })
})
