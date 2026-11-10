// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { EMPTY_PLAYBACK } from '@shared/types'
import ArtworkTile from '@/components/ArtworkTile.vue'

function mountTile(artworkUrl: string | null) {
  return mount(ArtworkTile, {
    props: {
      playback: { ...EMPTY_PLAYBACK, title: 'Rádio Oxigénio', artworkUrl },
      playing: true,
    },
  })
}

describe('ArtworkTile', () => {
  it('shows the speaker artwork when one is reported', () => {
    const wrapper = mountTile('http://example.com/cover.jpg')

    expect(wrapper.get('img.cover').attributes('src')).toBe('http://example.com/cover.jpg')
    wrapper.unmount()
  })

  it('falls back to the gradient when the artwork fails to load', async () => {
    const wrapper = mountTile('http://example.com/broken.jpg')

    await wrapper.get('img.cover').trigger('error')

    expect(wrapper.find('img.cover').exists()).toBe(false)
    expect(wrapper.find('.mark').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the gradient when there is no artwork', () => {
    const wrapper = mountTile(null)

    expect(wrapper.find('img.cover').exists()).toBe(false)
    wrapper.unmount()
  })
})
