import { isPlainObject } from './values.ts'

export type FieldMatcher = (keys: string[]) => boolean

export const TEXT_PRESETS = [
  {
    id: 'dates',
    label: 'Dates and times',
    pattern: String.raw`\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?|\b\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?\b`,
  },
  {
    id: 'uuids',
    label: 'IDs and hashes',
    pattern: String.raw`\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b|\b[0-9a-fA-F]{16,}\b`,
  },
  {
    id: 'numbers',
    label: 'Numbers',
    pattern: String.raw`\d+(?:[.,]\d+)*`,
  },
] as const

export type TextPreset = (typeof TEXT_PRESETS)[number]['id']

// XML attributes arrive as @_name and element text as #text; people know them as @name and text.
export function shownKey(key: string): string {
  if (key.startsWith('@_')) return `@${key.slice(2)}`
  if (key === '#text') return 'text'
  return key
}

function globToRegex(glob: string): RegExp {
  const source = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${source}$`, 'i')
}

export function splitList(text: string): string[] {
  return text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
}

// A bare name such as updatedAt matches that field at any depth. A dotted path such as
// meta.requestId matches fields whose path ends that way; list positions are skipped.
export function fieldMatcher(patterns: string[]): FieldMatcher | null {
  const parsed = patterns
    .map((pattern) => pattern.trim().replace(/\[[^\]]*\]/g, '').replace(/^\$\.?/, ''))
    .map((pattern) => pattern.split('.').filter(Boolean).map(globToRegex))
    .filter((segments) => segments.length > 0)
  if (parsed.length === 0) return null
  const matchesKey = (regex: RegExp, key: string) => {
    const shown = shownKey(key)
    return regex.test(shown) || (shown.startsWith('@') && regex.test(shown.slice(1)))
  }
  return (keys) => parsed.some((segments) => {
    if (segments.length > keys.length) return false
    const offset = keys.length - segments.length
    return segments.every((regex, index) => matchesKey(regex, keys[offset + index]))
  })
}

export function stripFields(value: unknown, matcher: FieldMatcher): { value: unknown; ignored: string[] } {
  const ignored = new Set<string>()
  const walk = (node: unknown, keys: string[]): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item, keys))
    if (!isPlainObject(node)) return node
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) {
      const next = [...keys, key]
      if (matcher(next)) {
        ignored.add(next.map(shownKey).join('.'))
        continue
      }
      out[key] = walk(child, next)
    }
    return out
  }
  return { value: walk(value, []), ignored: [...ignored] }
}

export function patternError(source: string): string | null {
  if (source.trim() === '') return null
  try {
    new RegExp(source)
    return null
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^Invalid regular expression: /, '') : 'This pattern has a syntax error'
  }
}

export function compileMask(sources: string[], ignoreCase: boolean): RegExp | null {
  const valid = sources.filter((source) => source.trim() !== '' && patternError(source) === null)
  if (valid.length === 0) return null
  return new RegExp(valid.map((source) => `(?:${source})`).join('|'), ignoreCase ? 'gi' : 'g')
}

export function listLabel(names: string[], limit = 3): string {
  const shown = names.slice(0, limit)
  const rest = names.length - shown.length
  if (rest > 0) return `${shown.join(', ')}, and ${rest} more`
  if (shown.length <= 2) return shown.join(' and ')
  return `${shown.slice(0, -1).join(', ')}, and ${shown[shown.length - 1]}`
}
