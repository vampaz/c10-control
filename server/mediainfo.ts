import { parseSoapResponse, unescapeXml } from './soap.ts'

export interface MediaInfo {
  /** URI the speaker is currently playing, empty when unknown. */
  url: string
  title: string
  subtitle: string
  artworkUrl: string | null
  isLive: boolean
}

export const EMPTY_MEDIA_INFO: MediaInfo = {
  url: '',
  title: '',
  subtitle: '',
  artworkUrl: null,
  isLive: true,
}

function textOf(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? unescapeXml(match[1]).trim() : ''
}

function clean(value: string): string {
  return value && value.toLowerCase() !== 'unknown' ? value : ''
}

function artworkUrlOf(value: string): string | null {
  return /^https?:\/\/\S+$/i.test(value) ? value : null
}

/**
 * Reads the DIDL-Lite document the speaker returns from `GetMediaInfo`.
 * TuneIn and our own pushed streams both put the cover art and subtitle there.
 */
export function parseMediaInfo(soapXml: string): MediaInfo {
  const fields = parseSoapResponse(soapXml)
  const didl = unescapeXml(fields.CurrentURIMetaData ?? '')
  const url = clean(unescapeXml(fields.CurrentURI ?? '').trim())
  const title = clean(textOf(didl, 'dc:title'))
  const subtitle = clean(textOf(didl, 'dc:subtitle'))
  const artworkUrl = artworkUrlOf(textOf(didl, 'upnp:albumArtURI'))
  const liveFlag = textOf(didl, 'song:isLive')
  const duration = /<res\b[^>]*\bduration="([^"]*)"/.exec(didl)?.[1] ?? ''

  return {
    url,
    title,
    subtitle,
    artworkUrl,
    isLive: liveFlag === '1' || (liveFlag === '' && duration === ''),
  }
}
