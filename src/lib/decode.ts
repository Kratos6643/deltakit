import { isPlainObject } from './values.ts'

export type DecodeKind = 'jwt' | 'base64' | 'url'

export type Fact = { label: string; value: string; detail?: string; tone?: 'good' | 'bad' }

export type Decoded = {
  output: string
  language: 'json' | 'text'
  notes: string[]
  title?: string
  facts: Fact[]
  params?: [string, string][]
  binary?: { bytes: Uint8Array; mime?: string; label: string }
}

export const KINDS: { id: DecodeKind; label: string; title: string }[] = [
  { id: 'jwt', label: 'JWT', title: 'Read the header and claims of a JSON Web Token' },
  { id: 'base64', label: 'Base64', title: 'Decode or encode Base64 text' },
  { id: 'url', label: 'URL', title: 'Decode or encode %-escaped text and links' },
]

const utf8 = new TextDecoder('utf-8', { fatal: true })

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`
}

export function relativeTime(target: number, now: number): string {
  const seconds = Math.round((target - now) / 1000)
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31_536_000], ['month', 2_592_000], ['day', 86_400], ['hour', 3600], ['minute', 60]]
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  }
  return format.format(seconds, 'second')
}

function moment(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

function base64Bytes(input: string): Uint8Array {
  const clean = input.replace(/\s+/g, '').replace(/=+$/, '')
  const stray = /[^A-Za-z0-9+/_-]/.exec(clean)
  if (stray) {
    throw new Error(`This text has “${stray[0]}”. Base64 uses only letters, digits, + and / (or - and _), with = at the end.`)
  }
  const standard = clean.replace(/-/g, '+').replace(/_/g, '/')
  if (standard.length % 4 === 1) throw new Error('This Base64 is one character short or long. Check that it was copied in full.')
  const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

// Tabs, line breaks, and form feeds are text; other control bytes mean a binary file.
function textOf(bytes: Uint8Array): string | null {
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) return null
  }
  try {
    return utf8.decode(bytes)
  } catch {
    return null
  }
}

function isJson(text: string): boolean {
  if (!/^\s*[[{]/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function jsonPart(segment: string, name: string): unknown {
  const text = textOf(base64Bytes(segment))
  if (text === null) throw new Error(`The ${name} of this token holds binary data. A JWT ${name} is JSON text.`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`The ${name} of this token is plain text. A JWT ${name} is JSON.`)
  }
}

function claimText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

export function decodeJwt(input: string, now = Date.now()): Decoded {
  const token = input.trim().replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3 && parts.length !== 5) {
    throw new Error('A JWT has three parts separated by dots: header, payload, and signature.')
  }
  const header = jsonPart(parts[0], 'header')
  const facts: Fact[] = []
  const notes: string[] = []
  const headerRecord = isPlainObject(header) ? header : {}
  if (headerRecord.alg !== undefined) facts.push({ label: 'Algorithm', value: claimText(headerRecord.alg) })
  if (headerRecord.typ !== undefined) facts.push({ label: 'Type', value: claimText(headerRecord.typ) })
  if (headerRecord.kid !== undefined) facts.push({ label: 'Key ID', value: claimText(headerRecord.kid) })

  if (parts.length === 5) {
    notes.push('This token is encrypted (JWE), so only its header can be read here.')
    return { output: `${JSON.stringify({ header }, null, 2)}\n`, language: 'json', notes, title: 'Encrypted token', facts }
  }

  const payloadBytes = base64Bytes(parts[1])
  const payloadText = textOf(payloadBytes)
  let payload: unknown = payloadText ?? `${payloadBytes.length} bytes of binary data`
  if (payloadText !== null) {
    try {
      payload = JSON.parse(payloadText)
    } catch {
      notes.push('The payload is plain text, so it appears as written.')
    }
  }

  const claims = isPlainObject(payload) ? payload : {}
  const named: [string, string][] = [['iss', 'Issuer'], ['sub', 'Subject'], ['aud', 'Audience'], ['jti', 'Token ID']]
  for (const [key, label] of named) if (claims[key] !== undefined) facts.push({ label, value: claimText(claims[key]) })
  const time = (key: string) => {
    const value = claims[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
  }
  const issued = time('iat')
  const notBefore = time('nbf')
  const expires = time('exp')
  if (issued !== undefined) facts.push({ label: 'Issued', value: moment(issued), detail: relativeTime(issued * 1000, now) })
  if (notBefore !== undefined) {
    const waiting = notBefore * 1000 > now
    facts.push({ label: 'Valid from', value: moment(notBefore), detail: relativeTime(notBefore * 1000, now), tone: waiting ? 'bad' : undefined })
  }
  if (expires !== undefined) {
    const expired = expires * 1000 <= now
    facts.push({ label: 'Expires', value: moment(expires), detail: relativeTime(expires * 1000, now), tone: expired ? 'bad' : 'good' })
  }

  const signature = parts[2] ?? ''
  if (headerRecord.alg === 'none' || signature === '') notes.push('This token has no signature, so anyone could have written it.')
  else facts.push({ label: 'Signature', value: plural(signature.length, 'character'), detail: 'Shown as-is; checking it needs the signing key' })

  const title = expires === undefined
    ? 'Token without an expiry time'
    : expires * 1000 <= now
      ? `Expired ${relativeTime(expires * 1000, now)}`
      : notBefore !== undefined && notBefore * 1000 > now
        ? `Becomes valid ${relativeTime(notBefore * 1000, now)}`
        : `Valid, expires ${relativeTime(expires * 1000, now)}`
  return { output: `${JSON.stringify({ header, payload }, null, 2)}\n`, language: 'json', notes, title, facts }
}

const SIGNATURES: { bytes: number[]; mime: string; label: string }[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png', label: 'PNG image' },
  { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg', label: 'JPEG image' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif', label: 'GIF image' },
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf', label: 'PDF document' },
  { bytes: [0x50, 0x4b, 0x03, 0x04], mime: 'application/zip', label: 'ZIP archive' },
  { bytes: [0x1f, 0x8b], mime: 'application/gzip', label: 'gzip file' },
]

function sniffBytes(bytes: Uint8Array, hint?: string): { mime?: string; label: string } {
  for (const item of SIGNATURES) {
    if (item.bytes.every((byte, index) => bytes[index] === byte)) return { mime: item.mime, label: item.label }
  }
  if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return { mime: 'image/webp', label: 'WebP image' }
  }
  return { mime: hint, label: hint ? `${hint} data` : 'Binary data' }
}

function hexDump(bytes: Uint8Array, limit = 512): string {
  const lines: string[] = []
  for (let offset = 0; offset < Math.min(bytes.length, limit); offset += 16) {
    const row = bytes.subarray(offset, Math.min(offset + 16, bytes.length))
    const hex = [...row].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
    const ascii = [...row].map((byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('')
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`)
  }
  if (bytes.length > limit) lines.push(`… ${plural(bytes.length - limit, 'more byte')}`)
  return `${lines.join('\n')}\n`
}

export function decodeBase64(input: string): Decoded {
  let source = input.trim()
  let hint: string | undefined
  const dataUrl = /^data:([^;,]*)((?:;[^;,]*)*),/i.exec(source)
  if (dataUrl) {
    hint = dataUrl[1] || undefined
    source = source.slice(dataUrl[0].length)
    if (!/;base64/i.test(dataUrl[2] ?? '')) return decodeUrl(source)
  }
  const bytes = base64Bytes(source)
  const notes: string[] = []
  if (/[-_]/.test(source)) notes.push('This was URL-safe Base64, which uses - and _ in place of + and /.')
  const text = textOf(bytes)
  if (text !== null) {
    return {
      output: text,
      language: isJson(text) ? 'json' : 'text',
      notes,
      title: `Decoded ${plural(bytes.length, 'byte')} of text`,
      facts: [{ label: 'Size', value: plural(bytes.length, 'byte') }, { label: 'Characters', value: text.length.toLocaleString() }],
    }
  }
  const kind = sniffBytes(bytes, hint)
  notes.push('This decodes to binary data. The result shows its first bytes; download it to open the file.')
  return {
    output: hexDump(bytes),
    language: 'text',
    notes,
    title: `${kind.label}, ${plural(bytes.length, 'byte')}`,
    facts: [{ label: 'Size', value: plural(bytes.length, 'byte') }, { label: 'Kind', value: kind.label }],
    binary: { bytes, mime: kind.mime, label: kind.label },
  }
}

export function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

// Decodes every %XX run that forms valid UTF-8 and keeps the rest as typed.
function decodePercent(input: string): { text: string; kept: boolean } {
  let kept = false
  const text = input.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run)
    } catch {
      kept = true
      return run
    }
  })
  return { text, kept }
}

export function decodeUrl(input: string): Decoded {
  const source = input.trim()
  const notes: string[] = []
  const { text, kept } = decodePercent(source.replace(/\+/g, ' '))
  if (source.includes('+')) notes.push('Plus signs were read as spaces, as they are in web forms and query strings.')
  if (kept) notes.push('Some % codes stay as typed because they form incomplete or invalid UTF-8 characters.')
  if (decodePercent(text).text !== text) notes.push('The result still has % codes, so it was probably encoded twice. Swap it into the input and decode again.')

  const facts: Fact[] = []
  let params: [string, string][] | undefined
  let url: URL | null = null
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(source)) {
    try {
      url = new URL(source)
    } catch {
      url = null
    }
  }
  if (url) {
    facts.push({ label: 'Address', value: url.origin })
    if (url.pathname && url.pathname !== '/') facts.push({ label: 'Path', value: decodePercent(url.pathname).text })
    if (url.hash) facts.push({ label: 'Fragment', value: decodePercent(url.hash.slice(1)).text })
    params = [...url.searchParams.entries()]
  } else if (/^[^\s=&]+=[^\s]*$/.test(source.replace(/^\?/, ''))) {
    params = [...new URLSearchParams(source.replace(/^\?/, '')).entries()]
  }
  if (params && params.length > 0) facts.push({ label: 'Query', value: plural(params.length, 'parameter') })
  return {
    output: text,
    language: 'text',
    notes,
    title: url ? 'Link' : params && params.length > 0 ? 'Query string' : 'Decoded text',
    facts,
    params: params && params.length > 0 ? params : undefined,
  }
}

export function encodeUrl(input: string): string {
  return encodeURIComponent(input.replace(/\r?\n$/, ''))
}

// Guesses what a pasted value is. Only clear cases count, so typing plain text never
// switches the decoder by surprise.
export function sniffEncoding(input: string): DecodeKind | null {
  const text = input.trim().replace(/^Bearer\s+/i, '')
  if (/^[\w-]{4,}\.[\w-]{4,}\.[\w-]*$/.test(text)) {
    try {
      const header = jsonPart(text.split('.')[0], 'header')
      if (isPlainObject(header) && ('alg' in header || 'typ' in header)) return 'jwt'
    } catch {
      // Not a token after all.
    }
  }
  if (/^data:[^,]*;base64,/i.test(text)) return 'base64'
  if (/%[0-9A-Fa-f]{2}/.test(text)) return 'url'
  const compact = text.replace(/[\r\n]+/g, '')
  if (compact.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.length % 4 === 0 && /[a-z]/.test(compact) && /[A-Z0-9+/=]/.test(compact)) {
    return 'base64'
  }
  return null
}
