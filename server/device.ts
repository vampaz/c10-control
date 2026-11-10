import type { AppConfig, DeviceInfo, PlaybackStatus, PlayTarget, SpeakerInput } from '../shared/types.ts'
import { buildDidl } from './didl.ts'
import { parseMediaInfo, type MediaInfo } from './mediainfo.ts'
import { buildSoapEnvelope, parseSoapFault, parseSoapResponse, unescapeXml } from './soap.ts'
import { mapTransportState, parsePlayerStatusPayload, type PlayerStatus } from './status.ts'

const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1'
const RENDERING_CONTROL = 'urn:schemas-upnp-org:service:RenderingControl:1'
const PLAY_QUEUE = 'urn:schemas-wiimu-com:service:PlayQueue:1'
const REQUEST_TIMEOUT_MS = 3000
const INPUTS: SpeakerInput[] = ['wifi', 'bluetooth', 'line-in', 'optical']

class SpeakerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpeakerError'
  }
}

/** Turns an undici `fetch failed` into the underlying socket reason. */
function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const cause = (error as { cause?: unknown }).cause
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return String((cause as { code: unknown }).code)
  }
  if (cause instanceof Error) {
    return cause.message
  }
  return error.message
}

async function request(url: string, init: RequestInit = {}): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    throw new SpeakerError(`Cannot reach the speaker: ${describeNetworkError(error)}`)
  }

  if (!response.ok) {
    throw new SpeakerError(`The speaker answered with HTTP ${response.status}`)
  }

  return response.text()
}

/** Thin client for the two control surfaces a Linkplay A28 speaker exposes. */
export class SpeakerDevice {
  private readonly config: AppConfig

  constructor(config: AppConfig) {
    this.config = config
  }

  async getPlayerStatus(): Promise<PlayerStatus> {
    const payload = await request(`http://${this.config.host}:${this.config.httpPort}/httpapi.asp?command=getPlayerStatus`)
    return parsePlayerStatusPayload(payload)
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const payload = await request(`http://${this.config.host}:${this.config.httpPort}/httpapi.asp?command=getStatusEx`)
    let parsed: Record<string, string>
    try {
      parsed = JSON.parse(payload) as Record<string, string>
    } catch {
      throw new SpeakerError('The speaker returned an unreadable status document')
    }

    return {
      host: this.config.host,
      name: parsed.DeviceName || parsed.GroupName || 'Audio Pro C10',
      model: parsed.project || parsed.hardware || 'Audio Pro C10',
      firmware: parsed.firmware || 'unknown',
      uuid: parsed.uuid || '',
    }
  }

  /** Cover art, subtitle and current URI from the UPnP media description. */
  async getMediaInfo(): Promise<MediaInfo> {
    return parseMediaInfo(await this.soapPayload(AV_TRANSPORT, 'rendertransport1', 'GetMediaInfo'))
  }

  /** Device status JSON: RSSI, Wi-Fi channel, internet and update flags. */
  async getDeviceDetails(): Promise<Record<string, string>> {
    const fields = await this.soap(RENDERING_CONTROL, 'rendercontrol1', 'GetControlDeviceInfo')
    try {
      return JSON.parse(unescapeXml(fields.Status ?? '{}')) as Record<string, string>
    } catch {
      return {}
    }
  }

  async setDeviceName(name: string): Promise<void> {
    await this.soap(RENDERING_CONTROL, 'rendercontrol1', 'SetDeviceName', { Name: name })
  }

  async createPlayQueue(context: string): Promise<void> {
    await this.soap(PLAY_QUEUE, 'PlayQueue1', 'CreateQueue', { QueueContext: context })
  }

  async deletePlayQueue(name: string): Promise<void> {
    await this.soap(PLAY_QUEUE, 'PlayQueue1', 'DeleteQueue', { QueueName: name })
  }

  async browsePlayQueue(name: string): Promise<string> {
    const fields = await this.soap(PLAY_QUEUE, 'PlayQueue1', 'BrowseQueue', { QueueName: name })
    return fields.QueueContext ?? ''
  }

  async playPlayQueue(name: string, index: number): Promise<void> {
    await this.soap(PLAY_QUEUE, 'PlayQueue1', 'PlayQueueWithIndex', { QueueName: name, Index: index })
  }

  async setPlayQueueLoop(mode: number): Promise<void> {
    await this.soap(PLAY_QUEUE, 'PlayQueue1', 'SetQueueLoopMode', { LoopMode: mode })
  }

  /** The authoritative play state, including for local files that report `none`. */
  async getTransportState(): Promise<PlaybackStatus> {
    const fields = await this.soap(AV_TRANSPORT, 'rendertransport1', 'GetTransportInfo')
    return mapTransportState(fields.CurrentTransportState)
  }

  async play(): Promise<void> {
    await this.soap(AV_TRANSPORT, 'rendertransport1', 'Play', { Speed: 1 })
  }

  /**
   * Replaces what the speaker is playing. The DIDL metadata is what makes the
   * device show a real title and artwork instead of the raw URL.
   */
  async playTarget(target: PlayTarget): Promise<void> {
    await this.soap(AV_TRANSPORT, 'rendertransport1', 'SetAVTransportURI', {
      CurrentURI: target.url,
      CurrentURIMetaData: buildDidl(target),
    })
    await this.play()
  }

  async pause(): Promise<void> {
    await this.soap(AV_TRANSPORT, 'rendertransport1', 'Pause')
  }

  async stop(): Promise<void> {
    await this.soap(AV_TRANSPORT, 'rendertransport1', 'Stop')
  }

  async next(): Promise<void> {
    await this.soap(AV_TRANSPORT, 'rendertransport1', 'Next')
  }

  async previous(): Promise<void> {
    await this.soap(AV_TRANSPORT, 'rendertransport1', 'Previous')
  }

  async seek(seconds: number): Promise<void> {
    const target = Math.max(0, Math.round(seconds))
    await this.soap(AV_TRANSPORT, 'rendertransport1', 'Seek', {
      Unit: 'REL_TIME',
      Target: toDuration(target),
    })
  }

  async setVolume(level: number): Promise<void> {
    const value = Math.min(100, Math.max(0, Math.round(level)))
    await this.soap(RENDERING_CONTROL, 'rendercontrol1', 'SetVolume', {
      Channel: 'Master',
      DesiredVolume: value,
    })
  }

  async setMute(muted: boolean): Promise<void> {
    await this.soap(RENDERING_CONTROL, 'rendercontrol1', 'SetMute', {
      Channel: 'Master',
      DesiredMute: muted ? 1 : 0,
    })
  }

  /** Switches the physical or network input. The firmware answers the literal `OK`. */
  async switchMode(mode: string): Promise<void> {
    if (!INPUTS.includes(mode as SpeakerInput)) {
      throw new SpeakerError(`Unknown input: ${mode}`)
    }

    const payload = await request(`http://${this.config.host}:${this.config.httpPort}/httpapi.asp?command=setPlayerCmd:switchmode:${mode}`)
    const answer = payload.trim()
    if (answer !== 'OK') {
      throw new SpeakerError(answer || 'The speaker rejected the input switch')
    }
  }

  private async soap(service: string, control: string, action: string, args?: Record<string, string | number>): Promise<Record<string, string>> {
    return parseSoapResponse(await this.soapPayload(service, control, action, args))
  }

  private async soapPayload(service: string, control: string, action: string, args?: Record<string, string | number>): Promise<string> {
    const url = `http://${this.config.host}:${this.config.upnpPort}/upnp/control/${control}`
    const body = buildSoapEnvelope({ service, action, args })

    const payload = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${service}#${action}"`,
      },
      body,
    })

    const fault = parseSoapFault(payload)
    if (fault) {
      throw new SpeakerError(`${action} failed: ${fault.description} (${fault.code})`)
    }

    return payload
  }
}

function toDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':')
}
