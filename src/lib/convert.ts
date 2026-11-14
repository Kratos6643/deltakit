import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import { dump, load, loadAll } from 'js-yaml'
import { csvDocument, DELIMITERS, detectDelimiter, formatCsv, parseCsv } from './csv.ts'
import { errorMessage, isPlainObject, jsonError } from './values.ts'

export type DataFormat = 'json' | 'yaml' | 'xml' | 'csv'

export type Conversion = { output: string; notes: string[] }

export const FORMATS: { id: DataFormat; label: string; ext: string }[] = [
  { id: 'json', label: 'JSON', ext: 'json' },
  { id: 'yaml', label: 'YAML', ext: 'yaml' },
  { id: 'xml', label: 'XML', ext: 'xml' },
  { id: 'csv', label: 'CSV', ext: 'csv' },
]

// Attributes become @name keys and element text becomes #text, so converting back to XML
// restores them as attributes and text.
const xmlReader = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  ignoreDeclaration: true,
  ignorePiTags: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

const xmlWriter = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true,
  // Without this an attribute whose value is "true" is written as a bare name, which is not XML.
  suppressBooleanAttributes: false,
})

const XML_NAME = /^[A-Za-z_][\w.:-]*$/

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`
}

// Keeps a CSV cell as text unless it reads back exactly the same as a number or literal.
function inferCell(text: string): unknown {
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null') return null
  if (/^-?\d/.test(text) && text.length <= 15 && String(Number(text)) === text) return Number(text)
  // A list inside a row is written as JSON text in one cell, so it comes back as a list.
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const list: unknown = JSON.parse(text)
      if (Array.isArray(list)) return list
    } catch {
      // Text that only looks like a list stays text.
    }
  }
  return text
}

// Dotted headers such as address.city go back to nested fields. They stay flat when a name
// is both a value and a parent (a and a.b), since one field cannot hold both.
function canNest(headers: string[]): boolean {
  if (!headers.some((header) => header.includes('.'))) return false
  const names = new Set(headers)
  return headers.every((header) => {
    const parts = header.split('.')
    if (parts.some((part) => part === '' || part === '__proto__')) return false
    return parts.slice(0, -1).every((_, index) => !names.has(parts.slice(0, index + 1).join('.')))
  })
}

function nest(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [header, cell] of Object.entries(row)) {
    const parts = header.split('.')
    let node = out
    for (const part of parts.slice(0, -1)) {
      if (!isPlainObject(node[part])) node[part] = {}
      node = node[part] as Record<string, unknown>
    }
    node[parts[parts.length - 1]] = cell
  }
  return out
}

type Read = { value: unknown; notes: string[] }

function readJson(input: string): Read {
  try {
    return { value: JSON.parse(input), notes: [] }
  } catch (error) {
    throw new Error(jsonError(input, error), { cause: error })
  }
}

function readYaml(input: string): Read {
  try {
    return { value: load(input) ?? null, notes: [] }
  } catch (error) {
    if (!/single document/i.test(errorMessage(error))) throw new Error(`Invalid YAML — ${errorMessage(error)}`, { cause: error })
  }
  try {
    const documents = loadAll(input)
    return { value: documents, notes: [`This YAML holds ${plural(documents.length, 'document')}, so they became one list.`] }
  } catch (error) {
    throw new Error(`Invalid YAML — ${errorMessage(error)}`, { cause: error })
  }
}

function attributesFirst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(attributesFirst)
  if (!isPlainObject(value)) return value
  const entries = Object.entries(value).map(([key, child]): [string, unknown] => [key, attributesFirst(child)])
  return Object.fromEntries([...entries.filter(([key]) => key.startsWith('@')), ...entries.filter(([key]) => !key.startsWith('@'))])
}

function readXml(input: string): Read {
  const valid = XMLValidator.validate(input)
  if (valid !== true) throw new Error(`Invalid XML at line ${valid.err.line} — ${valid.err.msg}`)
  return { value: attributesFirst(xmlReader.parse(input)), notes: [] }
}

function readCsv(input: string): Read {
  const delimiter = detectDelimiter(input)
  const { headers, rows } = csvDocument(parseCsv(input, true, delimiter))
  if (headers.length === 0) throw new Error('This CSV has no header row.')
  const flat = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, inferCell(String(cell))])))
  const nested = canNest(headers)
  const name = DELIMITERS.find((item) => item.id === delimiter)?.name ?? 'commas'
  const notes = [`Read ${plural(rows.length, 'row')} and ${plural(headers.length, 'column')} separated by ${name}. Numbers and true or false became values.`]
  if (nested) notes.push(`Columns with dotted names, such as ${headers.find((header) => header.includes('.'))}, became nested fields.`)
  return { value: nested ? flat.map(nest) : flat, notes }
}

function read(format: DataFormat, input: string): Read {
  if (format === 'json') return readJson(input)
  if (format === 'yaml') return readYaml(input)
  if (format === 'xml') return readXml(input)
  return readCsv(input)
}

function xmlName(key: string, renamed: Set<string>): string {
  if (key === '#text') return key
  const attribute = key.startsWith('@')
  const bare = attribute ? key.slice(1) : key
  if (XML_NAME.test(bare)) return key
  let name = bare.replace(/[^\w.:-]/g, '_')
  if (!/^[A-Za-z_]/.test(name)) name = `_${name}`
  renamed.add(bare)
  return attribute ? `@${name}` : name
}

function xmlTree(value: unknown, renamed: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => (Array.isArray(item) ? { item: xmlTree(item, renamed) } : xmlTree(item, renamed)))
  if (value instanceof Date) return value.toISOString()
  if (!isPlainObject(value)) return value ?? ''
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) out[xmlName(key, renamed)] = xmlTree(child, renamed)
  return out
}

function writeXml(value: unknown): Conversion {
  const notes: string[] = []
  const renamed = new Set<string>()
  const tree = xmlTree(value, renamed)
  let document: unknown = tree
  if (isPlainObject(tree)) {
    const keys = Object.keys(tree)
    const single = keys.length === 1 && !keys[0].startsWith('@') && keys[0] !== '#text' && !Array.isArray(tree[keys[0]])
    if (!single) {
      document = { root: tree }
      notes.push('XML needs one element at the top, so everything sits inside <root>.')
    }
  } else {
    document = { root: Array.isArray(tree) ? { item: tree } : tree }
    notes.push('XML needs one element at the top, so the data sits inside <root>.')
  }
  if (renamed.size > 0) {
    const names = [...renamed].slice(0, 3).map((name) => `“${name}”`).join(', ')
    notes.push(`Renamed ${plural(renamed.size, 'key')} to fit XML's naming rules, such as ${names}.`)
  }
  const body = String(xmlWriter.build(document)).trim()
  return { output: `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`, notes }
}

function largestList(value: unknown, path = ''): { records: unknown[]; path: string } | null {
  let best: { records: unknown[]; path: string } | null = null
  const consider = (records: unknown[], at: string) => {
    if (records.length > 0 && records.some(isPlainObject) && (!best || records.length > best.records.length)) best = { records, path: at }
  }
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      consider(node, at)
      return
    }
    if (!isPlainObject(node)) return
    for (const [key, child] of Object.entries(node)) walk(child, at ? `${at}.${key}` : key)
  }
  walk(value, path)
  return best
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function flatten(value: unknown, prefix: string, out: Map<string, string>) {
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) out.set(prefix || 'value', '')
    for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, out)
    return
  }
  out.set(prefix || 'value', cellString(value))
}

// XML keys arrive as @id and #text; as CSV headers they read better as id and text.
function headerName(column: string, taken: Set<string>): string {
  const plainName = column.replace(/(^|\.)@/g, '$1').replace(/(^|\.)#text$/, '$1text')
  return plainName !== column && !taken.has(plainName) ? plainName : column
}

function writeCsv(value: unknown): Conversion {
  const notes: string[] = []
  let records: unknown[]
  if (Array.isArray(value)) {
    records = value
  } else {
    const found = largestList(value)
    if (found && found.path) {
      records = found.records
      notes.push(`Used the list at “${found.path}”, the largest one in the file.`)
    } else {
      records = [value]
    }
  }
  const columns: string[] = []
  const known = new Set<string>()
  const flat = records.map((record) => {
    const out = new Map<string, string>()
    flatten(record, '', out)
    for (const key of out.keys()) {
      if (known.has(key)) continue
      known.add(key)
      columns.push(key)
    }
    return out
  })
  if (columns.some((column) => column.includes('.'))) notes.push('Nested fields became columns with dotted names, such as address.city.')
  if (records.some((record) => isPlainObject(record) && Object.values(record).some(Array.isArray))) {
    notes.push('Lists inside a row are written as JSON text in one cell.')
  }
  const headers = columns.map((column) => headerName(column, known))
  const rows = flat.map((cells) => columns.map((column) => cells.get(column) ?? ''))
  return { output: formatCsv([headers, ...rows]), notes }
}

function write(format: DataFormat, value: unknown): Conversion {
  if (format === 'json') return { output: `${JSON.stringify(value, null, 2) ?? 'null'}\n`, notes: [] }
  if (format === 'yaml') return { output: dump(value, { indent: 2, lineWidth: -1, noRefs: true, skipInvalid: true }), notes: [] }
  if (format === 'xml') return writeXml(value)
  return writeCsv(value)
}

export function convert(from: DataFormat, to: DataFormat, input: string): Conversion {
  const parsed = read(from, input)
  const written = write(to, parsed.value)
  return { output: written.output, notes: [...parsed.notes, ...written.notes] }
}

export function sniffFormat(name: string, text: string): DataFormat | null {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'json') return 'json'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'xml') return 'xml'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  const trimmed = text.trim()
  if (trimmed.startsWith('<')) return 'xml'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  return null
}
