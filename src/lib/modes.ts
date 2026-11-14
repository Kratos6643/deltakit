import type { Mode } from '../types.ts'

export const MODE_META = [
  { id: 'text', label: 'Text', ext: 'txt', blurb: 'Line, word, and character diffs. Tidy trims trailing spaces.' },
  { id: 'json', label: 'JSON', ext: 'json', blurb: 'Parsed values, type changes, and lists matched by id or name.' },
  { id: 'xml', label: 'XML', ext: 'xml', blurb: 'Tags, attributes, and text. Repeated elements stay aligned.' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', blurb: 'Structure first, then the formatted document.' },
  { id: 'csv', label: 'CSV', ext: 'csv', blurb: 'Rows matched by id or name, then compared cell by cell.' },
] as const

export function defaultName(side: 'before' | 'after', mode: Mode): string {
  const ext = MODE_META.find((item) => item.id === mode)?.ext ?? 'txt'
  return `${side}.${ext}`
}
