<script setup lang="ts">
import { computed } from 'vue'
import type { PlaybackState } from '@shared/types'

const props = defineProps<{ playback: PlaybackState; playing: boolean; online: boolean }>()

const hasTrack = computed(() => props.playback.title.length > 0)

const stateLabel = computed(() => {
  if (!props.online) {
    return 'Offline'
  }
  if (props.playing) {
    return props.playback.isLive ? 'Live' : 'Playing'
  }
  return props.playback.status === 'paused' ? 'Paused' : 'Stopped'
})

function display(value: string): string {
  return value && value.toLowerCase() !== 'unknown' ? value : ''
}
</script>

<template>
  <div class="track-info">
    <p class="eyebrow">
      <span v-if="playback.isLive && playing && online" class="live">Live</span>
      <span v-else :class="{ offline: !online }">{{ stateLabel }}</span>
    </p>

    <h1 class="title">{{ hasTrack ? playback.title : 'Nothing playing' }}</h1>

    <p v-if="display(playback.artist)" class="artist">{{ display(playback.artist) }}</p>
    <p v-if="display(playback.album)" class="album">{{ display(playback.album) }}</p>
    <p v-else-if="display(playback.subtitle)" class="album">{{ display(playback.subtitle) }}</p>
  </div>
</template>

<style scoped>
.track-info {
  display: grid;
  gap: 4px;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 12px;
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-dim);
  min-height: 1em;
}

.live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--accent);
}

.offline {
  color: var(--danger);
}

.live::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.title {
  margin: 0;
  font-size: clamp(1.9rem, 3.4vw, 2.9rem);
  font-weight: 500;
  line-height: 1.03;
  letter-spacing: -0.035em;
  text-wrap: balance;
  color: var(--ink);
}

.artist {
  margin: 12px 0 0;
  font-size: 1rem;
  color: var(--ink-dim);
}

.album {
  margin: 3px 0 0;
  font-size: 0.9rem;
  color: var(--ink-faint);
}

@media (max-width: 520px) {
  .title {
    font-size: clamp(1.45rem, 7vw, 1.9rem);
  }

  .eyebrow {
    margin-bottom: 8px;
  }

  .artist {
    margin-top: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .live::before {
    animation: none;
  }
}
</style>
