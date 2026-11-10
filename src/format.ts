export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00'
  }

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

/** Deterministic artwork gradient so every track gets its own tile. */
export function artworkStyle(seed: string): Record<string, string> {
  const hash = hashString(seed || 'silence')
  // Stay inside a warm amber-to-copper range so tiles sit next to the accent colour.
  const hue = 16 + (hash % 24)
  const second = (hue + 8 + (hash % 12)) % 360

  return {
    background: `radial-gradient(120% 120% at 22% 12%, hsl(${hue} 34% 30%) 0%, hsl(${second} 24% 13%) 58%, var(--artwork-end) 100%)`,
  }
}

/** Turns the firmware project id into something readable. */
export function prettyModel(model: string | undefined): string {
  if (!model) {
    return 'Audio Pro C10'
  }
  return model.replace(/^AudioPro_/i, 'Audio Pro ').replace(/_/g, ' ')
}

/** A readable label for a stream the user pasted, without asking for metadata. */
export function titleForUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
    return last.includes('.') ? decodeURIComponent(last) : parsed.hostname
  } catch {
    return url
  }
}
