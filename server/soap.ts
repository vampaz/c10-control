const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
}

export function unescapeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match
  })
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface SoapCall {
  service: string
  action: string
  args?: Record<string, string | number>
}

/** Builds the SOAP envelope every Linkplay UPnP endpoint expects. */
export function buildSoapEnvelope(call: SoapCall, instanceId = 0): string {
  const args = Object.entries(call.args ?? {})
    .map(([key, value]) => `<${key}>${escapeXml(String(value))}</${key}>`)
    .join('')

  return (
    '<?xml version="1.0"?>'
    + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"'
    + ' s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
    + `<s:Body><u:${call.action} xmlns:u="${call.service}">`
    + `<InstanceID>${instanceId}</InstanceID>${args}`
    + `</u:${call.action}></s:Body></s:Envelope>`
  )
}

/**
 * Returns the direct children of the `*Response` element as a flat map.
 * Values stay XML-escaped because Linkplay embeds DIDL-Lite documents in them.
 */
export function parseSoapResponse(xml: string): Record<string, string> {
  const responseMatch = /<(?:\w+:)?(\w+Response)\b[^>]*>([\s\S]*)<\/(?:\w+:)?\1>/.exec(xml)
  if (!responseMatch) {
    return {}
  }

  const body = responseMatch[2]
  const result: Record<string, string> = {}
  const tagPattern = /<(?:\w+:)?(\w+)\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?\1>)/g

  for (const match of body.matchAll(tagPattern)) {
    const [, tag, value = ''] = match
    result[tag] = value
  }

  return result
}

export interface SoapFault {
  code: number
  description: string
}

export function parseSoapFault(xml: string): SoapFault | null {
  const code = /<errorCode>(\d+)<\/errorCode>/.exec(xml)
  if (!code) {
    return null
  }
  const description = /<errorDescription>([\s\S]*?)<\/errorDescription>/.exec(xml)
  return {
    code: Number(code[1]),
    description: description ? unescapeXml(description[1].trim()) : 'Unknown UPnP error',
  }
}
