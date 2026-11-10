<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PlaybackState } from '@shared/types'
import { artworkStyle } from '@/format'

const props = defineProps<{ playback: PlaybackState; playing: boolean }>()

const style = computed(() => artworkStyle(`${props.playback.title}|${props.playback.artist}`))
const failed = ref(false)

watch(() => props.playback.artworkUrl, () => {
  failed.value = false
})
</script>

<template>
  <div class="artwork" :style="style">
    <img
      v-if="playback.artworkUrl && !failed"
      class="cover"
      :src="playback.artworkUrl"
      alt=""
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <span class="mark" aria-hidden="true">
      <span
        v-for="index in 4"
        :key="index"
        class="bar"
        :class="{ active: playing }"
        :style="{ animationDelay: `${index * 0.14}s` }"
      />
    </span>
  </div>
</template>

<style scoped>
.artwork {
  position: relative;
  aspect-ratio: 1;
  width: 100%;
  max-width: 400px;
  border-radius: 22px;
  overflow: hidden;
  background: #141416;
  box-shadow:
    0 36px 70px -34px rgba(0, 0, 0, 0.95),
    inset 0 0 0 1px rgba(255, 255, 255, 0.07);
}

.cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mark {
  position: absolute;
  inset: auto 0 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 5px;
  padding: 22px;
  height: 42%;
}

.bar {
  width: 4px;
  height: 22%;
  border-radius: 99px;
  background: rgba(244, 239, 232, 0.5);
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
  animation: breathe 1.6s ease-in-out infinite alternate;
  animation-play-state: paused;
}

.bar.active {
  animation-play-state: running;
}

.bar:nth-child(2) {
  height: 40%;
}
.bar:nth-child(3) {
  height: 68%;
}
.bar:nth-child(4) {
  height: 52%;
}

@keyframes breathe {
  from {
    transform: scaleY(0.55);
    opacity: 0.45;
  }
  to {
    transform: scaleY(1.15);
    opacity: 1;
  }
}

@media (max-width: 860px) {
  .artwork {
    max-width: 300px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bar {
    animation: none;
  }
}
</style>
