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
  | 'music'
  | 'browse'
  | 'search'
  | 'star'
  | 'starFilled'
  | 'plus'
  | 'shuffle'
  | 'repeat'
  | 'repeatOne'

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 22 })
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    aria-hidden="true"
    focusable="false"
  >
    <use :href="`/icons.svg#${name}`" width="100%" height="100%" />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  fill: currentColor;
}
</style>
