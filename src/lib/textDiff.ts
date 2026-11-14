import { diffArrays, diffChars, diffWordsWithSpace } from 'diff'
import type { DiffRow, Hunk, InlinePart, Span } from '../types.ts'
import { normalizeNewlines } from './values.ts'

export type LineOptions = {
  ignoreWhitespace: boolean
  ignoreCase: boolean
  mask?: RegExp | null
  pairChanges?: boolean
  timeout?: number
}

const WORD_LIMIT = 80_000
const CHAR_LIMIT = 12_000
const LINE_WORD_LIMIT = 4_000
const LINE_TIMEOUT = 1_500
const INLINE_TIMEOUT = 1_500
const SEGMENT_LIMIT = 6_000
const EXACT_EDIT_LIMIT = 6_000
const SPAN_BUDGET = 400_000
const SPAN_EDIT_LIMIT = 400
const PAIR_BLOCK_LIMIT = 10_000
const PAIR_BUDGET = 400_000
const PAIR_THRESHOLD = 0.5
const PATCH_CONTEXT = 3

const collator = new Intl.Collator(undefined, { numeric: true })

type LinePart = { count: number; added: boolean; removed: boolean }

export function toLines(text: string): string[] {
  if (text.length === 0) return []
  const normalized = normalizeNewlines(text)
  const lines = normalized.split('\n')
  if (normalized.endsWith('\n')) lines.pop()
  return lines
}

function normalizeLine(line: string, options: LineOptions): string {
  let value = line
  if (options.mask) value = value.replace(options.mask, '')
  if (options.ignoreWhitespace) value = value.trim()
  if (options.ignoreCase) value = value.toLowerCase()
  return value
}

export function sortLineText(text: string, options: LineOptions): string {
  const keyed = toLines(text).map((line) => ({ line, key: normalizeLine(line, options) }))
  keyed.sort((left, right) => {
    const order = collator.compare(left.key, right.key)
    if (order !== 0) return order
    return left.line < right.line ? -1 : left.line > right.line ? 1 : 0
  })
  if (keyed.length === 0) return ''
  return `${keyed.map((item) => item.line).join('\n')}\n`
}

function wordSpans(left: string, right: string): { left: Span[]; right: Span[] } | null {
  if (left.length > LINE_WORD_LIMIT || right.length > LINE_WORD_LIMIT) return null
  const parts = diffWordsWithSpace(left, right, { maxEditLength: SPAN_EDIT_LIMIT })
  if (!parts) return null
  const leftSpans: Span[] = []
  const rightSpans: Span[] = []
  for (const part of parts) {
    if (part.removed) leftSpans.push({ text: part.value, changed: true })
    else if (part.added) rightSpans.push({ text: part.value, changed: true })
    else {
      leftSpans.push({ text: part.value, changed: false })
      rightSpans.push({ text: part.value, changed: false })
    }
  }
  return { left: leftSpans, right: rightSpans }
}

function longestIncreasing(pairs: [number, number][]): [number, number][] {
  const tails: number[] = []
  const previous: number[] = new Array<number>(pairs.length).fill(-1)
  pairs.forEach(([, rightIndex], index) => {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (pairs[tails[middle]][1] < rightIndex) low = middle + 1
      else high = middle
    }
    previous[index] = low > 0 ? tails[low - 1] : -1
    tails[low] = index
  })
  const out: [number, number][] = []
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1
  while (cursor !== -1) {
    out.push(pairs[cursor])
    cursor = previous[cursor]
  }
  return out.reverse()
}

// Myers diff is O(N·D), so very different inputs can take minutes. This pass anchors on
// lines that occur exactly once on each side (patience diff) and only runs Myers on the
// small gaps between anchors, which keeps the work close to linear.
function anchoredParts(left: string[], right: string[], deadline: number): LinePart[] {
  const parts: LinePart[] = []
  const push = (count: number, added: boolean, removed: boolean) => {
    if (count === 0) return
    const last = parts[parts.length - 1]
    if (last && last.added === added && last.removed === removed) last.count += count
    else parts.push({ count, added, removed })
  }
  const segment = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) => {
    const leftCount = leftEnd - leftStart
    const rightCount = rightEnd - rightStart
    if (leftCount === 0 || rightCount === 0) {
      push(leftCount, false, true)
      push(rightCount, true, false)
      return
    }
    const remaining = deadline - Date.now()
    if (remaining > 0 && leftCount + rightCount <= SEGMENT_LIMIT) {
      const exact = diffArrays(left.slice(leftStart, leftEnd), right.slice(rightStart, rightEnd), { timeout: remaining })
      if (exact) {
        for (const part of exact) push(part.value.length, part.added, part.removed)
        return
      }
    }
    push(leftCount, false, true)
    push(rightCount, true, false)
  }

  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1
  let leftEnd = left.length
  let rightEnd = right.length
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1
    rightEnd -= 1
  }
  push(start, false, false)

  const seen = new Map<string, { left: number; right: number; leftIndex: number; rightIndex: number }>()
  for (let index = start; index < leftEnd; index += 1) {
    const entry = seen.get(left[index])
    if (entry) entry.left += 1
    else seen.set(left[index], { left: 1, right: 0, leftIndex: index, rightIndex: -1 })
  }
  for (let index = start; index < rightEnd; index += 1) {
    const entry = seen.get(right[index])
    if (!entry) continue
    entry.right += 1
    entry.rightIndex = index
  }
  const pairs: [number, number][] = []
  for (const entry of seen.values()) {
    if (entry.left === 1 && entry.right === 1) pairs.push([entry.leftIndex, entry.rightIndex])
  }
  pairs.sort((a, b) => a[0] - b[0])

  let leftCursor = start
  let rightCursor = start
  for (const [leftIndex, rightIndex] of longestIncreasing(pairs)) {
    segment(leftCursor, leftIndex, rightCursor, rightIndex)
    push(1, false, false)
    leftCursor = leftIndex + 1
    rightCursor = rightIndex + 1
  }
  segment(leftCursor, leftEnd, rightCursor, rightEnd)
  push(left.length - leftEnd, false, false)
  return parts
}

function unmatchedLines(left: string[], right: string[]): number {
  const counts = new Map<string, number>()
  for (const key of left) counts.set(key, (counts.get(key) ?? 0) + 1)
  let unmatched = 0
  for (const key of right) {
    const count = counts.get(key) ?? 0
    if (count > 0) counts.set(key, count - 1)
    else unmatched += 1
  }
  for (const count of counts.values()) unmatched += count
  return unmatched
}

function lineParts(left: string[], right: string[], options: LineOptions): { parts: LinePart[]; approximate: boolean } {
  const leftKeys = left.map((line) => normalizeLine(line, options))
  const rightKeys = right.map((line) => normalizeLine(line, options))
  const timeout = options.timeout ?? LINE_TIMEOUT
  if (unmatchedLines(leftKeys, rightKeys) <= EXACT_EDIT_LIMIT) {
    const exact = diffArrays(leftKeys, rightKeys, { timeout })
    if (exact) {
      return { parts: exact.map((part) => ({ count: part.value.length, added: part.added, removed: part.removed })), approximate: false }
    }
  }
  return { parts: anchoredParts(leftKeys, rightKeys, Date.now() + timeout), approximate: true }
}

type Grams = { counts: Map<string, number>; size: number }

function gramsOf(text: string): Grams {
  const counts = new Map<string, number>()
  for (let index = 0; index < text.length - 1; index += 1) {
    const gram = text.slice(index, index + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return { counts, size: Math.max(text.length - 1, 0) }
}

function likeness(left: Grams, right: Grams): number {
  if (left.size === 0 || right.size === 0) return 0
  const [small, large] = left.counts.size <= right.counts.size ? [left.counts, right.counts] : [right.counts, left.counts]
  let shared = 0
  for (const [gram, count] of small) shared += Math.min(count, large.get(gram) ?? 0)
  return (2 * shared) / (left.size + right.size)
}

export function similarity(left: string, right: string): number {
  if (left === right) return 1
  return likeness(gramsOf(left), gramsOf(right))
}

// Inside a block of changed lines, pairs each removed line with the added line it most
// resembles while keeping both sides in order, so one inserted line does not shift every
// pairing after it. Lines left over between pairs still sit side by side.
function pairBlock(removed: string[], added: string[]): [number | undefined, number | undefined][] {
  const width = added.length + 1
  const score = new Float64Array((removed.length + 1) * width)
  const step = new Uint8Array((removed.length + 1) * width)
  const leftGrams = removed.map(gramsOf)
  const rightGrams = added.map(gramsOf)
  for (let row = 0; row <= removed.length; row += 1) {
    for (let column = 0; column <= added.length; column += 1) {
      if (row === 0 && column === 0) continue
      let best = -1
      let move = 0
      if (row > 0) {
        best = score[(row - 1) * width + column]
        move = 1
      }
      if (column > 0 && score[row * width + column - 1] > best) {
        best = score[row * width + column - 1]
        move = 2
      }
      if (row > 0 && column > 0) {
        const value = likeness(leftGrams[row - 1], rightGrams[column - 1])
        const paired = score[(row - 1) * width + column - 1] + value
        if (value >= PAIR_THRESHOLD && paired >= best) {
          best = paired
          move = 3
        }
      }
      score[row * width + column] = best
      step[row * width + column] = move
    }
  }

  const path: [number | undefined, number | undefined][] = []
  let row = removed.length
  let column = added.length
  while (row > 0 || column > 0) {
    const move = step[row * width + column]
    if (move === 3) {
      row -= 1
      column -= 1
      path.push([row, column])
    } else if (move === 1) {
      row -= 1
      path.push([row, undefined])
    } else {
      column -= 1
      path.push([undefined, column])
    }
  }
  path.reverse()

  const order: [number | undefined, number | undefined][] = []
  let lefts: number[] = []
  let rights: number[] = []
  const flush = () => {
    for (let index = 0; index < Math.max(lefts.length, rights.length); index += 1) order.push([lefts[index], rights[index]])
    lefts = []
    rights = []
  }
  for (const [before, after] of path) {
    if (before !== undefined && after !== undefined) {
      flush()
      order.push([before, after])
    } else if (before !== undefined) {
      lefts.push(before)
    } else if (after !== undefined) {
      rights.push(after)
    }
  }
  flush()
  return order
}

export function alignLines(leftText: string, rightText: string, options: LineOptions): { rows: DiffRow[]; approximate: boolean } {
  const left = toLines(leftText)
  const right = toLines(rightText)
  const { parts, approximate } = lineParts(left, right, options)
  const rows: DiffRow[] = []
  let spanBudget = SPAN_BUDGET
  let pairBudget = PAIR_BUDGET
  let leftIndex = 0
  let rightIndex = 0
  let partIndex = 0

  const pushEqual = (before: string, after: string) => {
    rows.push({
      kind: 'equal',
      left: before,
      right: after,
      leftNo: leftIndex + 1,
      rightNo: rightIndex + 1,
      fuzzy: before !== after,
    })
    leftIndex += 1
    rightIndex += 1
  }
  const pushRemove = (before: string) => {
    rows.push({ kind: 'remove', left: before, leftNo: leftIndex + 1 })
    leftIndex += 1
  }
  const pushAdd = (after: string) => {
    rows.push({ kind: 'add', right: after, rightNo: rightIndex + 1 })
    rightIndex += 1
  }
  const pushModify = (before: string, after: string) => {
    const spans = spanBudget > 0 ? wordSpans(before, after) : null
    spanBudget -= before.length + after.length
    rows.push({
      kind: 'modify',
      left: before,
      right: after,
      leftNo: leftIndex + 1,
      rightNo: rightIndex + 1,
      leftSpans: spans?.left,
      rightSpans: spans?.right,
    })
    leftIndex += 1
    rightIndex += 1
  }
  const pushPaired = (before: string | undefined, after: string | undefined) => {
    if (options.pairChanges === false) {
      if (before !== undefined) pushRemove(before)
      if (after !== undefined) pushAdd(after)
      return
    }
    if (before !== undefined && after !== undefined) {
      if (before.length === 0 || after.length === 0) {
        pushRemove(before)
        pushAdd(after)
      } else {
        pushModify(before, after)
      }
      return
    }
    if (before !== undefined) pushRemove(before)
    else if (after !== undefined) pushAdd(after)
  }
  const pushBlock = (removedCount: number, addedCount: number) => {
    const removed = left.slice(leftIndex, leftIndex + removedCount)
    const added = right.slice(rightIndex, rightIndex + addedCount)
    const size = removed.length * added.length
    if (options.pairChanges !== false && size > 1 && size <= PAIR_BLOCK_LIMIT && size <= pairBudget) {
      pairBudget -= size
      const order = pairBlock(removed.map((line) => normalizeLine(line, options)), added.map((line) => normalizeLine(line, options)))
      for (const [before, after] of order) {
        pushPaired(before === undefined ? undefined : removed[before], after === undefined ? undefined : added[after])
      }
      return
    }
    const count = Math.max(removed.length, added.length)
    for (let index = 0; index < count; index += 1) pushPaired(removed[index], added[index])
  }

  while (partIndex < parts.length) {
    const part = parts[partIndex]
    const next = parts[partIndex + 1]
    if (part.removed && next?.added) {
      pushBlock(part.count, next.count)
      partIndex += 2
      continue
    }
    if (part.added && next?.removed) {
      pushBlock(next.count, part.count)
      partIndex += 2
      continue
    }
    if (part.removed) {
      for (const line of left.slice(leftIndex, leftIndex + part.count)) pushRemove(line)
    } else if (part.added) {
      for (const line of right.slice(rightIndex, rightIndex + part.count)) pushAdd(line)
    } else {
      for (let index = 0; index < part.count; index += 1) {
        pushEqual(left[leftIndex] ?? '', right[rightIndex] ?? '')
      }
    }
    partIndex += 1
  }

  return { rows, approximate }
}

export function buildHunks(rows: DiffRow[]): Hunk[] {
  const hunks: Hunk[] = []
  let index = 0
  while (index < rows.length) {
    const row = rows[index]
    if (!row || row.kind === 'equal') {
      index += 1
      continue
    }
    const start = index
    while (index < rows.length && rows[index]?.kind !== 'equal') index += 1
    const slice = rows.slice(start, index)
    const kinds = new Set(slice.map((item) => item.kind))
    const kind = kinds.size === 1 && kinds.has('add') ? 'add' : kinds.size === 1 && kinds.has('remove') ? 'remove' : 'modify'
    const previewSource = slice.find((item) => (item.left ?? item.right ?? '').trim().length > 0)
    const preview = (previewSource?.left ?? previewSource?.right ?? '').trim() || '(blank line)'
    hunks.push({
      id: `hunk-${start}`,
      rowIndex: start,
      kind,
      count: slice.length,
      leftNo: slice[0]?.leftNo,
      rightNo: slice[0]?.rightNo,
      preview: preview.length > 96 ? `${preview.slice(0, 95)}…` : preview,
    })
  }
  return hunks
}

function buildInline(left: string, right: string, ignoreCase: boolean, limit: number): InlinePart[] | null {
  if (left.length + right.length > limit) return null
  const parts = limit === CHAR_LIMIT
    ? diffChars(left, right, { ignoreCase, timeout: INLINE_TIMEOUT })
    : diffWordsWithSpace(left, right, { ignoreCase, timeout: INLINE_TIMEOUT })
  if (!parts) return null
  return parts.map((part) => ({
    text: part.value,
    kind: part.added ? 'add' : part.removed ? 'remove' : 'equal',
  }))
}

export function buildWords(left: string, right: string, ignoreCase: boolean): InlinePart[] | null {
  return buildInline(left, right, ignoreCase, WORD_LIMIT)
}

export function buildChars(left: string, right: string, ignoreCase: boolean): InlinePart[] | null {
  return buildInline(left, right, ignoreCase, CHAR_LIMIT)
}

type PatchItem = {
  change: boolean
  minus?: string
  plus?: string
  leftLine?: number
  rightLine?: number
}

// Builds a unified diff from the rows already on screen, so the patch matches the
// comparison options and the expensive line diff only runs once.
export function buildPatch(leftName: string, rightName: string, rows: DiffRow[], endsWithNewline: { left: boolean; right: boolean }): string {
  const leftTotal = rows.filter((row) => row.kind !== 'add').length
  const rightTotal = rows.filter((row) => row.kind !== 'remove').length
  const items: PatchItem[] = []
  const leftBefore: number[] = []
  const rightBefore: number[] = []
  let leftLine = 0
  let rightLine = 0
  for (const row of rows) {
    leftBefore.push(leftLine)
    rightBefore.push(rightLine)
    if (row.kind === 'equal') {
      leftLine += 1
      rightLine += 1
      const leftBreak = leftLine < leftTotal || endsWithNewline.left
      const rightBreak = rightLine < rightTotal || endsWithNewline.right
      items.push(leftBreak === rightBreak
        ? { change: false, minus: row.left, leftLine, rightLine }
        : { change: true, minus: row.left, plus: row.right, leftLine, rightLine })
    } else if (row.kind === 'remove') {
      leftLine += 1
      items.push({ change: true, minus: row.left, leftLine })
    } else if (row.kind === 'add') {
      rightLine += 1
      items.push({ change: true, plus: row.right, rightLine })
    } else {
      leftLine += 1
      rightLine += 1
      items.push({ change: true, minus: row.left, plus: row.right, leftLine, rightLine })
    }
  }

  const ranges: [number, number][] = []
  items.forEach((item, index) => {
    if (!item.change) return
    const start = Math.max(0, index - PATCH_CONTEXT)
    const end = Math.min(items.length - 1, index + PATCH_CONTEXT)
    const last = ranges[ranges.length - 1]
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  })
  if (ranges.length === 0) return ''

  const noNewline = '\\ No newline at end of file'
  const leftMissingBreak = (line?: number) => line === leftTotal && !endsWithNewline.left
  const rightMissingBreak = (line?: number) => line === rightTotal && !endsWithNewline.right
  const out = [`--- ${leftName}`, `+++ ${rightName}`]
  for (const [start, end] of ranges) {
    const slice = items.slice(start, end + 1)
    const oldLines = slice.filter((item) => item.minus !== undefined).length
    const newLines = slice.filter((item) => item.plus !== undefined || !item.change).length
    const oldStart = leftBefore[start] + (oldLines > 0 ? 1 : 0)
    const newStart = rightBefore[start] + (newLines > 0 ? 1 : 0)
    out.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`)
    let index = 0
    while (index < slice.length) {
      const item = slice[index]
      if (!item.change) {
        out.push(` ${item.minus ?? ''}`)
        if (leftMissingBreak(item.leftLine)) out.push(noNewline)
        index += 1
        continue
      }
      const run: PatchItem[] = []
      while (index < slice.length && slice[index].change) {
        run.push(slice[index])
        index += 1
      }
      for (const change of run) {
        if (change.minus === undefined) continue
        out.push(`-${change.minus}`)
        if (leftMissingBreak(change.leftLine)) out.push(noNewline)
      }
      for (const change of run) {
        if (change.plus === undefined) continue
        out.push(`+${change.plus}`)
        if (rightMissingBreak(change.rightLine)) out.push(noNewline)
      }
    }
  }
  return `${out.join('\n')}\n`
}

export { CHAR_LIMIT, WORD_LIMIT }
