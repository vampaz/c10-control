import type { PlayTarget } from '../shared/types.ts'
import { buildDidl } from './didl.ts'

/** Name the app gives its queue on the speaker. */
export const SPEAKER_QUEUE_NAME = 'C10Control'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * The Wiimu PlayQueue context: a PlayList document with one Track element per
 * target, each carrying DIDL metadata. The device then owns next and previous.
 */
export function buildQueueContext(name: string, targets: PlayTarget[]): string {
  const tracks = targets
    .map((target, index) => {
      const metadata = escapeXml(buildDidl(target))
      return `<Track${index + 1}>`
        + `<URL>${escapeXml(target.url)}</URL>`
        + `<Source>${escapeXml(name)}</Source>`
        + '<Key></Key>'
        + '<Id></Id>'
        + `<Metadata>${metadata}</Metadata>`
        + `</Track${index + 1}>`
    })
    .join('')

  return '<?xml version="1.0"?>'
    + `<PlayList><ListName>${escapeXml(name)}</ListName>`
    + '<ListInfo><Radio>0</Radio>'
    + `<SourceName>${escapeXml(name)}</SourceName>`
    + `<TrackNumber>${targets.length}</TrackNumber>`
    + '<SearchUrl></SearchUrl><Quality>0</Quality></ListInfo>'
    + `<Tracks>${tracks}</Tracks></PlayList>`
}

export interface SpeakerQueueTrack {
  title: string
  url: string
}

/** Reads a PlayList document returned by BrowseQueue. */
export function parseQueueContext(xml: string): SpeakerQueueTrack[] {
  const tracks: SpeakerQueueTrack[] = []

  for (const match of xml.matchAll(/<Track\d+>([\s\S]*?)<\/Track\d+>/g)) {
    const block = match[1]
    const url = unescapeXml(/<URL>([\s\S]*?)<\/URL>/.exec(block)?.[1] ?? '')
    const metadata = unescapeXml(/<Metadata>([\s\S]*?)<\/Metadata>/.exec(block)?.[1] ?? '')
    const title = unescapeXml(/<dc:title>([\s\S]*?)<\/dc:title>/.exec(metadata)?.[1] ?? '')
    if (url) {
      tracks.push({ title: title || url, url })
    }
  }

  return tracks
}
