import type { CompareOptions, CompareResult, CompareStats, GridModel, InlinePart, Mode } from '../types.ts'
import { buildGrid } from './csv.ts'
import { parseSide, type SideOptions } from './format.ts'
import { compileMask, fieldMatcher, listLabel, shownKey } from './ignore.ts'
import { buildStructure } from './structure.ts'
import { alignLines, buildChars, buildHunks, buildPatch, buildWords, CHAR_LIMIT, sortLineText, toLines, WORD_LIMIT } from './textDiff.ts'
import { isPlainObject } from './values.ts'

function emptyStats(): CompareStats {
  return {
    addedLines: 0,
    removedLines: 0,
    modifiedLines: 0,
    unchangedLines: 0,
    similarity: 100,
    textMatch: null,
    fieldMatch: null,
    addedChars: null,
    removedChars: null,
    moved: 0,
    addedFields: 0,
    removedFields: 0,
    changedFields: 0,
  }
}

export function emptyResult(message?: string): CompareResult {
  return {
    rows: [],
    hunks: [],
    inline: [],
    chars: [],
    tree: null,
    changes: [],
    fields: [],
    grid: null,
    patch: '',
    notices: message ? [message] : [],
    info: [],
    keyChoices: [],
    approximate: false,
    stats: emptyStats(),
  }
}

function endsWithBreak(text: string): boolean {
  return text.length === 0 || text.endsWith('\n')
}

function collectRecords(value: unknown, path: string, out: { path: string; rows: Record<string, unknown>[] }[]) {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(isPlainObject) && !path.includes('[')) {
      out.push({ path: path || 'rows', rows: value })
    }
    value.forEach((item, index) => collectRecords(item, `${path}[${index}]`, out))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    collectRecords(child, childPath, out)
  }
}

function pickGrid(left: unknown, right: unknown): { path: string; left: Record<string, unknown>[]; right: Record<string, unknown>[] } | null {
  const found = new Map<string, { left: Record<string, unknown>[]; right: Record<string, unknown>[] }>()
  for (const item of gather(left)) {
    const current = found.get(item.path) ?? { left: [], right: [] }
    current.left = item.rows
    found.set(item.path, current)
  }
  for (const item of gather(right)) {
    const current = found.get(item.path) ?? { left: [], right: [] }
    current.right = item.rows
    found.set(item.path, current)
  }
  let best: { path: string; left: Record<string, unknown>[]; right: Record<string, unknown>[]; score: number } | null = null
  for (const [path, rows] of found) {
    const score = rows.left.length + rows.right.length
    if (score === 0) continue
    if (!best || score > best.score) best = { path, left: rows.left, right: rows.right, score }
  }
  return best ? { path: best.path, left: best.left, right: best.right } : null
}

function gather(value: unknown) {
  const out: { path: string; rows: Record<string, unknown>[] }[] = []
  collectRecords(value, '', out)
  return out
}

// Field names that appear in lists of records, most common first, to suggest as match keys.
function listKeys(values: unknown[]): string[] {
  const counts = new Map<string, number>()
  let budget = 5000
  const walk = (value: unknown) => {
    if (budget <= 0) return
    if (Array.isArray(value)) {
      const records = value.length > 0 && value.every(isPlainObject)
      for (const item of value) {
        budget -= 1
        if (budget <= 0) return
        if (records) {
          for (const key of Object.keys(item as Record<string, unknown>)) counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        walk(item)
      }
      return
    }
    if (isPlainObject(value)) for (const child of Object.values(value)) walk(child)
  }
  values.forEach(walk)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([key]) => shownKey(key))
}

function quoted(names: string[]): string {
  return listLabel(names.map((name) => `“${name}”`))
}

function percent(part: number, total: number): number {
  if (total === 0) return 100
  return Math.round((part / total) * 1000) / 10
}

function textMatch(parts: InlinePart[] | null): number | null {
  if (!parts) return null
  let same = 0
  let changed = 0
  for (const part of parts) {
    if (part.kind === 'equal') same += part.text.length
    else changed += part.text.length
  }
  return percent(2 * same, 2 * same + changed)
}

export function compare(mode: Mode, left: string, right: string, leftName: string, rightName: string, options: CompareOptions): CompareResult {
  try {
    const structured = mode !== 'text'
    const sideOptions: SideOptions = {
      ignoreFormatting: options.ignoreFormatting,
      ignoreKeyOrder: options.ignoreKeyOrder,
      ignoreListOrder: structured && options.ignoreListOrder,
      delimiter: options.delimiter,
      matchKeys: options.matchKeys,
      ignore: structured ? fieldMatcher(options.ignoreFields) : null,
    }
    const leftSide = parseSide(mode, left, sideOptions)
    const rightSide = parseSide(mode, right, sideOptions)
    const mask = structured ? null : compileMask(options.ignoreText, options.ignoreCase)
    const lineOptions = {
      ignoreWhitespace: options.ignoreWhitespace,
      ignoreCase: options.ignoreCase,
      mask,
      pairChanges: !options.sortLines,
    }
    const leftText = options.sortLines ? sortLineText(leftSide.text, lineOptions) : leftSide.text
    const rightText = options.sortLines ? sortLineText(rightSide.text, lineOptions) : rightSide.text
    const { rows, approximate } = alignLines(leftText, rightText, lineOptions)
    if (options.sortLines) {
      for (const row of rows) {
        row.leftNo = undefined
        row.rightNo = undefined
      }
    }
    const hunks = buildHunks(rows)
    const inline = buildWords(leftText, rightText, options.ignoreCase)
    const chars = buildChars(leftText, rightText, options.ignoreCase)
    const size = leftText.length + rightText.length
    const notices: string[] = []
    if (leftSide.empty && !rightSide.empty) notices.push('The before side is empty.')
    if (rightSide.empty && !leftSide.empty) notices.push('The after side is empty.')
    if (leftSide.error) notices.push(leftSide.error)
    if (rightSide.error) notices.push(rightSide.error)

    const structure = !structured || leftSide.error || rightSide.error
      ? null
      : buildStructure(
          leftSide.empty ? undefined : leftSide.value,
          rightSide.empty ? undefined : rightSide.value,
          { xml: mode === 'xml', ignoreKeyOrder: options.ignoreKeyOrder, ignoreListOrder: options.ignoreListOrder, matchKeys: options.matchKeys },
        )

    const gridOptions = { matchKeys: options.matchKeys, ignoreListOrder: options.ignoreListOrder }
    let grid: GridModel | null = null
    if (mode === 'csv' && !leftSide.error && !rightSide.error) {
      grid = buildGrid(
        leftSide.csv?.rows ?? [],
        rightSide.csv?.rows ?? [],
        'rows',
        { left: leftSide.csv?.headers ?? [], right: rightSide.csv?.headers ?? [] },
        gridOptions,
      )
    } else if (structure && !leftSide.empty && !rightSide.empty) {
      const picked = pickGrid(leftSide.value, rightSide.value)
      if (picked) grid = buildGrid(picked.left, picked.right, picked.path, undefined, gridOptions)
    }

    const info: string[] = []
    if (structured && options.ignoreFields.length > 0 && !leftSide.error && !rightSide.error) {
      const ignored = [...new Set([...leftSide.ignored, ...rightSide.ignored])]
      const noun = mode === 'csv' ? 'column' : 'field'
      info.push(ignored.length > 0
        ? `Ignored ${ignored.length === 1 ? noun : `${noun}s`}: ${listLabel(ignored)}.`
        : `No ${noun} matches ${quoted(options.ignoreFields)}, so nothing was left out.`)
    }
    if (mask) {
      const test = new RegExp(mask.source, mask.flags.replace('g', ''))
      const count = toLines(leftText).filter((line) => test.test(line)).length + toLines(rightText).filter((line) => test.test(line)).length
      info.push(count > 0
        ? `Ignored matching text on ${count.toLocaleString()} ${count === 1 ? 'line' : 'lines'}.`
        : 'No text matches the ignore patterns, so every character counts.')
    }
    if (structured && options.matchKeys.length > 0 && (structure || grid)) {
      const used = new Set([...(structure?.usedKeys ?? []), grid?.key ?? ''].map((key) => key.toLowerCase()))
      if (!options.matchKeys.some((key) => used.has(key.replace(/^@/, '').toLowerCase()))) {
        info.push(`Items were matched automatically, since no list has a unique ${quoted(options.matchKeys)} on every item.`)
      }
    }
    const keyChoices = mode === 'csv'
      ? [...new Set([...(leftSide.csv?.headers ?? []), ...(rightSide.csv?.headers ?? [])])]
      : structure ? listKeys([leftSide.value, rightSide.value]) : []

    const addedLines = rows.filter((row) => row.kind === 'add').length
    const removedLines = rows.filter((row) => row.kind === 'remove').length
    const modifiedLines = rows.filter((row) => row.kind === 'modify').length
    const unchangedLines = rows.filter((row) => row.kind === 'equal').length
    const changes = structure?.changes ?? []
    const fields = structure?.fields ?? []
    const sameFields = fields.filter((field) => field.status === 'same' && !field.reordered).length
    const charParts = chars ?? inline
    const stats: CompareStats = {
      addedLines,
      removedLines,
      modifiedLines,
      unchangedLines,
      similarity: percent(unchangedLines, addedLines + removedLines + modifiedLines + unchangedLines),
      textMatch: textMatch(inline),
      fieldMatch: fields.length > 0 ? percent(sameFields, fields.length) : null,
      addedChars: charParts ? charParts.filter((part) => part.kind === 'add').reduce((sum, part) => sum + part.text.length, 0) : null,
      removedChars: charParts ? charParts.filter((part) => part.kind === 'remove').reduce((sum, part) => sum + part.text.length, 0) : null,
      moved: changes.filter((change) => change.kind === 'moved').length,
      addedFields: changes.filter((change) => change.kind === 'added').length,
      removedFields: changes.filter((change) => change.kind === 'removed').length,
      changedFields: changes.filter((change) => change.kind === 'changed' || change.kind === 'type').length,
    }

    return {
      rows,
      hunks,
      inline,
      chars,
      tree: structure?.tree ?? null,
      changes,
      fields,
      grid,
      patch: buildPatch(leftName, rightName, rows, { left: endsWithBreak(leftText), right: endsWithBreak(rightText) }),
      leftError: leftSide.error,
      rightError: rightSide.error,
      notices,
      info,
      delimiters: mode === 'csv' ? { left: leftSide.delimiter, right: rightSide.delimiter } : undefined,
      keyChoices,
      approximate,
      inlineNote: inline ? undefined : size > WORD_LIMIT
        ? 'Track changes works on files up to about 80,000 characters. Side by side and Inline still show every change.'
        : 'These texts differ too much to follow word by word. Side by side and Inline still show every change.',
      charsNote: chars ? undefined : size > CHAR_LIMIT
        ? 'By character works on files up to about 12,000 characters. Switch to By word.'
        : 'These texts differ too much to follow character by character. Switch to By word.',
      stats,
    }
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : 'Could not compare these files')
  }
}

export function buildReport(result: CompareResult, leftName: string, rightName: string): string {
  const { stats } = result
  const lines = [
    'DeltaKit comparison',
    `${leftName}  →  ${rightName}`,
    [
      stats.textMatch === null ? '' : `Text match ${stats.textMatch}%`,
      `Line match ${stats.similarity}%`,
      stats.fieldMatch === null ? '' : `Field match ${stats.fieldMatch}%`,
    ].filter(Boolean).join(' · '),
    `Lines  +${stats.addedLines}  −${stats.removedLines}  ~${stats.modifiedLines}`,
  ]
  if (stats.addedChars !== null && stats.removedChars !== null) {
    lines.push(`Characters  +${stats.addedChars}  −${stats.removedChars}`)
  }
  if (result.changes.length > 0) {
    lines.push('', 'Structure')
    for (const change of result.changes) {
      const note = change.note ? ` (${change.note})` : ''
      lines.push(`${change.kind.padEnd(9, ' ')} ${change.path}${note}`)
      if (change.left) lines.push(`  before ${change.left}`)
      if (change.right) lines.push(`  after  ${change.right}`)
    }
  }
  return lines.join('\n')
}
