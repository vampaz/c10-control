import type { PlayTarget } from '../shared/types.ts'
import { escapeXml } from './soap.ts'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

/** Guess a DLNA mime type from the URL path, defaulting to MPEG audio. */
export function guessMime(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase()
    const extension = path.slice(path.lastIndexOf('.'))
    return MIME_BY_EXTENSION[extension] ?? 'audio/mpeg'
  } catch {
    return 'audio/mpeg'
  }
}

/**
 * Builds the DIDL-Lite document the speaker stores with a URI. Without it the
 * device shows the raw URL as the track title.
 */
export function buildDidl(target: PlayTarget): string {
  const title = escapeXml(target.title?.trim() || target.url)
  const artist = target.artist ? `<dc:creator>${escapeXml(target.artist)}</dc:creator>` : ''
  const artwork = target.artworkUrl
    ? `<upnp:albumArtURI>${escapeXml(target.artworkUrl)}</upnp:albumArtURI>`
    : ''
  const mediaClass = target.isLive === false
    ? 'object.item.audioItem.musicTrack'
    : 'object.item.audioItem.audioBroadcast'

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"',
    ' xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">',
    '<item id="0" parentID="-1" restricted="1">',
    `<dc:title>${title}</dc:title>`,
    artist,
    `<upnp:class>${mediaClass}</upnp:class>`,
    artwork,
    `<res protocolInfo="http-get:*:${guessMime(target.url)}:*">${escapeXml(target.url)}</res>`,
    '</item>',
    '</DIDL-Lite>',
  ].join('')
}
