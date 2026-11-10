<script setup lang="ts">
export type IconName =
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'volume'
  | 'mute'
  | 'settings'
  | 'close'
  | 'broadcast'
  | 'browse'
  | 'search'
  | 'star'
  | 'starFilled'
  | 'plus'
  | 'shuffle'
  | 'repeat'
  | 'repeatOne'

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 22 })

const SOLID: IconName[] = ['play', 'pause', 'next', 'previous', 'starFilled']

const PATHS: Record<IconName, string> = {
  play: 'M9 5.2 19.4 12 9 18.8Z',
  pause: 'M9 5h2.6v14H9zM12.4 5H15v14h-2.4z',
  next: 'M7.2 6.2 15 12l-7.8 5.8ZM17.4 5.5h1.6v13h-1.6z',
  previous: 'M16.8 6.2 9 12l7.8 5.8ZM5 5.5h1.6v13H5z',
  volume: 'M4 9.6h3L11.4 5v14L7 14.4H4ZM15 9.4a4.2 4.2 0 0 1 0 5.2M17.7 6.6a8 8 0 0 1 0 10.8',
  mute: 'M4 9.6h3L11.4 5v14L7 14.4H4ZM15.4 9.6l5 4.8M20.4 9.6l-5 4.8',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a1.9 1.9 0 1 1 0-3.8h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a1.9 1.9 0 1 1 3.8 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1Z',
  close: 'M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6',
  broadcast: 'M12 12.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2ZM8.1 6.5a7.6 7.6 0 0 0 0 9M15.9 6.5a7.6 7.6 0 0 1 0 9',
  browse: 'M4 7h16M4 12h16M4 17h9',
  search: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6ZM15.8 15.8 20.5 20.5',
  star: 'M12 4.6l2.3 4.66 5.15.75-3.73 3.63.88 5.12L12 16.34l-4.6 2.42.88-5.12-3.73-3.63 5.15-.75z',
  starFilled: 'M12 3.8l2.55 5.17 5.7.83-4.13 4.02.98 5.68L12 16.82l-5.1 2.68.98-5.68L3.75 9.8l5.7-.83z',
  plus: 'M12 5v14M5 12h14',
  shuffle: 'M4 7h3.4l9.2 10H20M4 17h3.4l3-3.3M14.6 10.3l1.9-3.3H20M17 4.2 20 6.8l-3 2.6M17 14.4 20 17l-3 2.6',
  repeat: 'M4 9V8a3 3 0 0 1 3-3h10M14 2.5 17 5l-3 2.5M20 15v1a3 3 0 0 1-3 3H7M10 21.5 7 19l3-2.5',
  repeatOne: 'M4 9V8a3 3 0 0 1 3-3h10M14 2.5 17 5l-3 2.5M20 15v1a3 3 0 0 1-3 3H7M10 21.5 7 19l3-2.5M11.3 10.8 12.6 10v4.6',
}
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    :fill="SOLID.includes(name) ? 'currentColor' : 'none'"
    :stroke="SOLID.includes(name) ? 'none' : 'currentColor'"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
}
</style>
