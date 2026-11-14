import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser'
import { dump, load } from 'js-yaml'
import type { CompareOptions, Delimiter, Mode } from '../types.ts'
import { csvDocument, detectDelimiter, dropColumns, formatCsv, parseCsv, type CsvDoc } from './csv.ts'
import { stripFields, type FieldMatcher } from './ignore.ts'
import { sortLists } from './structure.ts'
import { errorMessage, jsonError, normalizeNewlines, sortKeys } from './values.ts'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  ignoreDeclaration: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  removeNSPrefix: false,
})

function xmlBuilder(format: boolean) {
  return new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    format,
    indentBy: '  ',
    suppressEmptyNode: false,
    // Without this an attribute whose value is "true" is written as a bare name, which is not XML.
    suppressBooleanAttributes: false,
  })
}

// The parser reads broken XML without complaint, so the document is checked first.
function parseXml(input: string): unknown {
  const valid = XMLValidator.validate(input)
  if (valid !== true) throw new Error(`line ${valid.err.line}: ${valid.err.msg}`)
  return xmlParser.parse(input)
}

export function tidyText(input: string): string {
  const lines = normalizeNewlines(input).split('\n').map((line) => line.trimEnd())
  const text = lines.join('\n')
  return text.endsWith('\n') || text.length === 0 ? text : `${text}\n`
}

export function xmlDeclaration(input: string): string | null {
  const match = /^\uFEFF?\s*(<\?xml\b[^?]*\?>)/i.exec(input)
  return match?.[1] ?? null
}

function renderXml(parsed: unknown, declaration: string | null, format: boolean): string {
  const body = String(xmlBuilder(format).build(parsed)).trim()
  const document = declaration ? `${declaration}\n${body}` : body
  return document.length === 0 ? '' : `${document}\n`
}

export function beautifyXml(input: string, format = true): string {
  return renderXml(parseXml(input), xmlDeclaration(input), format)
}

function withDeclaration(parsed: unknown, declaration: string | null): unknown {
  if (!declaration) return parsed
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { '?xml': declaration, ...(parsed as Record<string, unknown>) }
  }
  return { '?xml': declaration, '#document': parsed }
}

function finish(text: string): string {
  if (text.length === 0) return ''
  return text.endsWith('\n') ? text : `${text}\n`
}

export type FormatOp = 'pretty' | 'minify' | 'sort' | 'tidy'

export function formatSource(mode: Mode, input: string, op: FormatOp): string {
  if (input.trim() === '') return ''
  if (mode === 'text' || op === 'tidy') return tidyText(input)
  if (mode === 'json') {
    const value: unknown = JSON.parse(input)
    if (op === 'minify') return JSON.stringify(value)
    if (op === 'sort') return finish(JSON.stringify(sortKeys(value), null, 2))
    return finish(JSON.stringify(value, null, 2))
  }
  if (mode === 'xml') {
    if (op === 'minify') return beautifyXml(input, false)
    return beautifyXml(input, true)
  }
  if (mode === 'yaml') {
    const value = load(input)
    return dump(op === 'sort' ? sortKeys(value) : value, {
      indent: 2,
      lineWidth: 100,
      noRefs: true,
      sortKeys: op === 'sort',
    })
  }
  const delimiter = detectDelimiter(input)
  return formatCsv(parseCsv(input, true, delimiter), delimiter)
}

export type SideOptions = Pick<CompareOptions, 'ignoreFormatting' | 'ignoreKeyOrder' | 'ignoreListOrder' | 'delimiter' | 'matchKeys'> & {
  ignore: FieldMatcher | null
}

export type SideDocument = {
  raw: string
  text: string
  value: unknown
  empty: boolean
  error?: string
  csv?: CsvDoc
  delimiter?: Delimiter
  ignored: string[]
}

function prepare(parsed: unknown, options: SideOptions): { value: unknown; rendered: unknown; ignored: string[] } {
  const { value, ignored } = options.ignore ? stripFields(parsed, options.ignore) : { value: parsed, ignored: [] }
  const rendered = options.ignoreListOrder ? sortLists(value, options.matchKeys) : value
  return { value, rendered, ignored }
}

const rowOrder = new Intl.Collator(undefined, { numeric: true })

export function parseSide(mode: Mode, input: string, options: SideOptions): SideDocument {
  const raw = normalizeNewlines(input)
  if (input.trim() === '') return { raw, text: '', value: undefined, empty: true, ignored: [] }

  if (mode === 'text') return { raw, text: raw, value: raw, empty: false, ignored: [] }

  const failed = (error: string): SideDocument => ({ raw, text: raw, value: undefined, empty: false, error, ignored: [] })

  if (mode === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(input)
    } catch (error) {
      return failed(jsonError(input, error))
    }
    const { value, rendered, ignored } = prepare(parsed, options)
    const text = options.ignoreFormatting ? finish(JSON.stringify(options.ignoreKeyOrder ? sortKeys(rendered) : rendered, null, 2)) : raw
    return { raw, text, value, empty: false, ignored }
  }

  if (mode === 'xml') {
    let parsed: unknown
    try {
      parsed = parseXml(input)
    } catch (error) {
      return failed(`Invalid XML — ${errorMessage(error)}`)
    }
    const declaration = xmlDeclaration(input)
    const { value, rendered, ignored } = prepare(parsed, options)
    const text = options.ignoreFormatting ? renderXml(rendered, declaration, true) : raw
    return { raw, text, value: withDeclaration(value, declaration), empty: false, ignored }
  }

  if (mode === 'yaml') {
    let parsed: unknown
    try {
      parsed = load(input)
    } catch (error) {
      return failed(`Invalid YAML — ${errorMessage(error)}`)
    }
    const { value, rendered, ignored } = prepare(parsed, options)
    const text = options.ignoreFormatting
      ? dump(options.ignoreKeyOrder ? sortKeys(rendered) : rendered, { indent: 2, lineWidth: 100, noRefs: true, sortKeys: options.ignoreKeyOrder })
      : raw
    return { raw, text, value, empty: false, ignored }
  }

  const delimiter = options.delimiter === 'auto' ? detectDelimiter(input) : options.delimiter
  const parsed = parseCsv(input, options.ignoreFormatting, delimiter)
  const ignore = options.ignore
  const { matrix, dropped } = ignore ? dropColumns(parsed, (name) => ignore([name])) : { matrix: parsed, dropped: [] }
  const csv = csvDocument(matrix)
  let text = raw
  if (options.ignoreFormatting) {
    const [header, ...body] = matrix
    const rows = options.ignoreListOrder
      ? [...body].sort((a, b) => rowOrder.compare(a.join('\u0001'), b.join('\u0001')))
      : body
    text = formatCsv(header ? [header, ...rows] : [])
  }
  return { raw, text, value: csv.rows, empty: false, csv, delimiter, ignored: dropped }
}
