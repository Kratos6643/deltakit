import type { Delimiter, GridCell, GridColumn, GridModel, GridRow } from '../types.ts'
import { alignItems, movedPositions } from './align.ts'
import { cellText, typeName } from './values.ts'

export const DELIMITERS: { id: Delimiter; label: string; name: string }[] = [
  { id: ',', label: 'Comma', name: 'commas' },
  { id: ';', label: 'Semicolon', name: 'semicolons' },
  { id: '\t', label: 'Tab', name: 'tabs' },
  { id: '|', label: 'Pipe', name: 'pipes' },
]

function countOutside(line: string, delimiter: string): number {
  let count = 0
  let quoted = false
  for (const char of line) {
    if (char === '"') quoted = !quoted
    else if (char === delimiter && !quoted) count += 1
  }
  return count
}

// Picks the separator that splits the first lines into the same number of cells most often.
export function detectDelimiter(input: string): Delimiter {
  const lines = input.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/, 40).filter((line) => line.trim() !== '').slice(0, 20)
  let best: { id: Delimiter; score: number } = { id: ',', score: 0 }
  for (const { id } of DELIMITERS) {
    const counts = lines.map((line) => countOutside(line, id))
    const first = counts[0] ?? 0
    if (first === 0) continue
    const score = counts.filter((count) => count === first).length * 1000 + first
    if (score > best.score) best = { id, score }
  }
  return best.id
}

export function parseCsv(input: string, trim: boolean, delimiter: Delimiter = ','): string[][] {
  const source = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(trim ? cell.trim() : cell)
      cell = ''
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(trim ? cell.trim() : cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += char
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(trim ? cell.trim() : cell)
    rows.push(row)
  }

  while (rows.length > 0 && rows[rows.length - 1]?.every((value) => value === '')) rows.pop()
  return rows
}

export function formatCsv(rows: string[][], delimiter: Delimiter = ','): string {
  const escape = (value: string) => {
    if (value.includes(delimiter) || /["\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
  }
  if (rows.length === 0) return ''
  return `${rows.map((row) => row.map(escape).join(delimiter)).join('\n')}\n`
}

export type CsvDoc = {
  headers: string[]
  rows: Record<string, unknown>[]
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((header) => {
    const name = header.trim() || 'column'
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name} (${count + 1})`
  })
}

export function csvDocument(matrix: string[][]): CsvDoc {
  if (matrix.length === 0) return { headers: [], rows: [] }
  const headers = uniqueHeaders(matrix[0] ?? [])
  const rows = matrix.slice(1).filter((row) => row.some((cell) => cell.trim() !== '')).map((row) => {
    const record: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      record[header] = row[index] ?? ''
    })
    return record
  })
  return { headers, rows }
}

export function dropColumns(matrix: string[][], drop: (name: string) => boolean): { matrix: string[][]; dropped: string[] } {
  const header = matrix[0]
  if (!header) return { matrix, dropped: [] }
  const keep = header.map((name) => !drop(name.trim()))
  if (keep.every(Boolean)) return { matrix, dropped: [] }
  return {
    matrix: matrix.map((row) => row.filter((_, index) => keep[index] ?? true)),
    dropped: header.filter((_, index) => !keep[index]).map((name) => name.trim()),
  }
}

const ID_KEYS = ['id', 'name', 'key', 'sku', 'email', 'path']

function signature(value: unknown): string {
  if (value === undefined) return 'missing'
  return `${typeName(value)}:${cellText(value)}`
}

function columnsFrom(leftRows: Record<string, unknown>[], rightRows: Record<string, unknown>[], headers?: { left: string[]; right: string[] }): GridColumn[] {
  const leftNames = headers?.left ?? []
  const rightNames = headers?.right ?? []
  if (!headers) {
    const collect = (rows: Record<string, unknown>[], names: string[]) => {
      const known = new Set(names)
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          if (known.has(key)) continue
          known.add(key)
          names.push(key)
        }
      }
    }
    collect(leftRows, leftNames)
    collect(rightRows, rightNames)
  }
  const rightSet = new Set(rightNames)
  const leftSet = new Set(leftNames)
  return [
    ...leftNames.map((name) => ({ name, status: rightSet.has(name) ? 'same' as const : 'removed' as const })),
    ...rightNames.filter((name) => !leftSet.has(name)).map((name) => ({ name, status: 'added' as const })),
  ]
}

function matchKey(columns: GridColumn[], leftRows: Record<string, unknown>[], rightRows: Record<string, unknown>[], candidates: string[]): string | null {
  if (leftRows.length === 0 || rightRows.length === 0) return null
  for (const wanted of candidates) {
    const column = columns.find((item) => item.status === 'same' && item.name.toLowerCase() === wanted.toLowerCase())
    if (!column) continue
    const name = column.name
    const leftIds = leftRows.map((row) => cellText(row[name]))
    const rightIds = rightRows.map((row) => cellText(row[name]))
    if (leftIds.some((id) => id === '') || rightIds.some((id) => id === '')) continue
    if (new Set(leftIds).size !== leftIds.length || new Set(rightIds).size !== rightIds.length) continue
    return name
  }
  return null
}

function buildCells(columns: GridColumn[], left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): GridCell[] {
  return columns.map((column) => {
    const leftHas = !!left && Object.prototype.hasOwnProperty.call(left, column.name)
    const rightHas = !!right && Object.prototype.hasOwnProperty.call(right, column.name)
    const leftValue = leftHas ? left?.[column.name] : undefined
    const rightValue = rightHas ? right?.[column.name] : undefined

    if (!left && right) {
      return { status: rightHas ? 'added' : 'missing', text: rightHas ? cellText(rightValue) : '' }
    }
    if (left && !right) {
      return { status: leftHas ? 'removed' : 'missing', text: leftHas ? cellText(leftValue) : '' }
    }
    if (column.status === 'removed') {
      return { status: 'removed', text: leftHas ? cellText(leftValue) : '' }
    }
    if (column.status === 'added') {
      return { status: 'added', text: rightHas ? cellText(rightValue) : '' }
    }
    if (!leftHas && !rightHas) return { status: 'missing', text: '' }
    if (!leftHas && rightHas) return { status: 'added', text: cellText(rightValue) }
    if (leftHas && !rightHas) return { status: 'removed', text: cellText(leftValue) }
    if (signature(leftValue) === signature(rightValue)) return { status: 'same', text: cellText(rightValue) }
    return {
      status: 'changed',
      text: cellText(rightValue),
      before: cellText(leftValue),
      typeLabel: typeName(leftValue) === typeName(rightValue) ? undefined : `${typeName(leftValue)} → ${typeName(rightValue)}`,
    }
  })
}

function rowStatus(cells: GridCell[], moved: boolean): GridRow['status'] {
  if (cells.some((cell) => cell.status === 'changed' || cell.status === 'added' || cell.status === 'removed')) {
    return 'changed'
  }
  return moved ? 'moved' : 'same'
}

export type GridOptions = {
  matchKeys: string[]
  ignoreListOrder: boolean
}

function keyedRows(columns: GridColumn[], leftRows: Record<string, unknown>[], rightRows: Record<string, unknown>[], path: string, key: string, options: GridOptions): GridRow[] {
  const rightById = new Map<string, number>()
  rightRows.forEach((row, index) => rightById.set(cellText(row[key]), index))
  const matched: { row: GridRow; from: number; to: number }[] = []
  const rows: GridRow[] = []
  const seen = new Set<string>()
  leftRows.forEach((row, index) => {
    const id = cellText(row[key])
    const match = rightById.get(id)
    if (match === undefined) {
      rows.push({ id: `${path}:${id}:removed`, status: 'removed', label: id, cells: buildCells(columns, row, undefined) })
      return
    }
    seen.add(id)
    const cells = buildCells(columns, row, rightRows[match])
    const gridRow: GridRow = { id: `${path}:${id}`, status: rowStatus(cells, false), label: id, cells }
    matched.push({ row: gridRow, from: index, to: match })
    rows.push(gridRow)
  })
  if (!options.ignoreListOrder) {
    for (const position of movedPositions(matched.map((item) => item.to))) {
      const { row, from, to } = matched[position]
      row.note = `row ${from + 1} → ${to + 1}`
      if (row.status === 'same') row.status = 'moved'
    }
  }
  rightRows.forEach((row) => {
    const id = cellText(row[key])
    if (seen.has(id)) return
    rows.push({ id: `${path}:${id}:added`, status: 'added', label: id, cells: buildCells(columns, undefined, row) })
  })
  return rows
}

function alignedRows(columns: GridColumn[], leftRows: Record<string, unknown>[], rightRows: Record<string, unknown>[], path: string, options: GridOptions): GridRow[] {
  const shared = columns.filter((column) => column.status === 'same').map((column) => column.name)
  const rowSig = (row: Record<string, unknown>) => shared.map((name) => signature(row[name])).join('\u0001')
  const links = alignItems(leftRows.map(rowSig), rightRows.map(rowSig), {
    unordered: options.ignoreListOrder,
    positional: false,
    likeness: (from, to) => {
      if (shared.length === 0) return 0
      let same = 0
      for (const name of shared) if (signature(leftRows[from][name]) === signature(rightRows[to][name])) same += 1
      return same / shared.length
    },
  }) ?? Array.from({ length: Math.max(leftRows.length, rightRows.length) }, (_, index) => ({
    left: index < leftRows.length ? index : undefined,
    right: index < rightRows.length ? index : undefined,
    moved: false,
  }))
  return links.map((link): GridRow => {
    if (link.right === undefined) {
      const from = link.left ?? 0
      return { id: `${path}:${from}:removed`, status: 'removed', label: `Row ${from + 1}`, cells: buildCells(columns, leftRows[from], undefined) }
    }
    const to = link.right
    if (link.left === undefined) {
      return { id: `${path}:${to}:added`, status: 'added', label: `Row ${to + 1}`, cells: buildCells(columns, undefined, rightRows[to]) }
    }
    const cells = buildCells(columns, leftRows[link.left], rightRows[to])
    return {
      id: `${path}:${to}`,
      status: rowStatus(cells, !!link.moved),
      label: `Row ${to + 1}`,
      note: link.moved ? `row ${link.left + 1} → ${to + 1}` : undefined,
      cells,
    }
  })
}

export function buildGrid(
  leftRows: Record<string, unknown>[],
  rightRows: Record<string, unknown>[],
  path: string,
  headers?: { left: string[]; right: string[] },
  options: GridOptions = { matchKeys: [], ignoreListOrder: false },
): GridModel {
  const columns = columnsFrom(leftRows, rightRows, headers)
  const key = matchKey(columns, leftRows, rightRows, [...options.matchKeys, ...ID_KEYS])
  const rows = key
    ? keyedRows(columns, leftRows, rightRows, path, key, options)
    : alignedRows(columns, leftRows, rightRows, path, options)
  return { path, columns, rows, key: key ?? undefined }
}
