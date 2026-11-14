import { diffArrays } from 'diff'

export type Link = { left?: number; right?: number; moved?: boolean }

export type AlignOptions = {
  unordered: boolean
  // Plain values pair up by position inside a changed block. Records pair with the one
  // they resemble most, so a removed record and an unrelated new one stay apart.
  positional: boolean
  likeness: (left: number, right: number) => number
}

const ALIGN_TIMEOUT = 400
const PAIR_LIMIT = 10_000
const PAIR_THRESHOLD = 0.5

function pairInOrder(rows: number, columns: number, score: (row: number, column: number) => number): [number | undefined, number | undefined][] {
  const width = columns + 1
  const total = new Float64Array((rows + 1) * width)
  const step = new Uint8Array((rows + 1) * width)
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      if (row === 0 && column === 0) continue
      let best = -1
      let move = 0
      if (row > 0) {
        best = total[(row - 1) * width + column]
        move = 1
      }
      if (column > 0 && total[row * width + column - 1] > best) {
        best = total[row * width + column - 1]
        move = 2
      }
      if (row > 0 && column > 0) {
        const value = score(row - 1, column - 1)
        const paired = total[(row - 1) * width + column - 1] + value
        if (value >= PAIR_THRESHOLD && paired >= best) {
          best = paired
          move = 3
        }
      }
      total[row * width + column] = best
      step[row * width + column] = move
    }
  }
  const path: [number | undefined, number | undefined][] = []
  let row = rows
  let column = columns
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
  return path.reverse()
}

function pairByPosition(rows: number, columns: number): [number | undefined, number | undefined][] {
  const out: [number | undefined, number | undefined][] = []
  for (let index = 0; index < Math.max(rows, columns); index += 1) {
    out.push([index < rows ? index : undefined, index < columns ? index : undefined])
  }
  return out
}

function alignOrdered(leftSigs: string[], rightSigs: string[], options: AlignOptions): Link[] | null {
  const parts = diffArrays(leftSigs, rightSigs, { timeout: ALIGN_TIMEOUT })
  if (!parts) return null
  const links: Link[] = []
  let left = 0
  let right = 0
  let index = 0
  while (index < parts.length) {
    const part = parts[index]
    if (!part.added && !part.removed) {
      for (let step = 0; step < part.value.length; step += 1) {
        links.push({ left, right })
        left += 1
        right += 1
      }
      index += 1
      continue
    }
    let removed = 0
    let added = 0
    while (index < parts.length && (parts[index].added || parts[index].removed)) {
      if (parts[index].removed) removed += parts[index].value.length
      else added += parts[index].value.length
      index += 1
    }
    const startLeft = left
    const startRight = right
    const pairs = options.positional || removed * added > PAIR_LIMIT
      ? pairByPosition(removed, added)
      : pairInOrder(removed, added, (row, column) => options.likeness(startLeft + row, startRight + column))
    for (const [row, column] of pairs) {
      links.push({
        left: row === undefined ? undefined : startLeft + row,
        right: column === undefined ? undefined : startRight + column,
      })
    }
    left += removed
    right += added
  }
  return links
}

// An item removed in one place and added unchanged in another moved.
function markMoves(links: Link[], leftSigs: string[], rightSigs: string[]): Link[] {
  const removed = new Map<string, number[]>()
  links.forEach((link, position) => {
    if (link.left === undefined || link.right !== undefined) return
    const sig = leftSigs[link.left]
    const queue = removed.get(sig)
    if (queue) queue.push(position)
    else removed.set(sig, [position])
  })
  if (removed.size === 0) return links
  const dropped = new Set<number>()
  const cursor = new Map<string, number>()
  for (const link of links) {
    if (link.right === undefined || link.left !== undefined) continue
    const sig = rightSigs[link.right]
    const queue = removed.get(sig)
    const at = cursor.get(sig) ?? 0
    if (!queue || at >= queue.length) continue
    cursor.set(sig, at + 1)
    link.left = links[queue[at]].left
    link.moved = true
    dropped.add(queue[at])
  }
  return dropped.size > 0 ? links.filter((_, position) => !dropped.has(position)) : links
}

function alignUnordered(leftSigs: string[], rightSigs: string[], options: AlignOptions): Link[] {
  const byValue = new Map<string, number[]>()
  rightSigs.forEach((sig, index) => {
    const list = byValue.get(sig)
    if (list) list.push(index)
    else byValue.set(sig, [index])
  })
  const leftTo = new Int32Array(leftSigs.length).fill(-1)
  const rightFrom = new Int32Array(rightSigs.length).fill(-1)
  const cursor = new Map<string, number>()
  leftSigs.forEach((sig, index) => {
    const list = byValue.get(sig)
    const at = cursor.get(sig) ?? 0
    if (!list || at >= list.length) return
    cursor.set(sig, at + 1)
    leftTo[index] = list[at]
    rightFrom[list[at]] = index
  })

  if (!options.positional) {
    const restLeft = [...leftTo.keys()].filter((index) => leftTo[index] === -1)
    const restRight = [...rightFrom.keys()].filter((index) => rightFrom[index] === -1)
    if (restLeft.length * restRight.length <= PAIR_LIMIT) {
      const candidates: [number, number, number][] = []
      for (const left of restLeft) {
        for (const right of restRight) {
          const score = options.likeness(left, right)
          if (score >= PAIR_THRESHOLD) candidates.push([score, left, right])
        }
      }
      candidates.sort((a, b) => b[0] - a[0])
      for (const [, left, right] of candidates) {
        if (leftTo[left] !== -1 || rightFrom[right] !== -1) continue
        leftTo[left] = right
        rightFrom[right] = left
      }
    }
  }

  const links: Link[] = []
  rightFrom.forEach((left, right) => links.push(left === -1 ? { right } : { left, right }))
  leftTo.forEach((right, left) => {
    if (right === -1) links.push({ left })
  })
  return links
}

// Lines items up by value. Returns null when the lists differ too much to finish quickly,
// so the caller can fall back to matching by position.
export function alignItems(leftSigs: string[], rightSigs: string[], options: AlignOptions): Link[] | null {
  if (options.unordered) return alignUnordered(leftSigs, rightSigs, options)
  const links = alignOrdered(leftSigs, rightSigs, options)
  return links ? markMoves(links, leftSigs, rightSigs) : null
}

// Given where each matched item landed, keeps the largest group that stayed in order and
// returns the rest, which are the items that actually moved.
export function movedPositions(targets: number[]): Set<number> {
  const tails: number[] = []
  const previous = new Int32Array(targets.length).fill(-1)
  targets.forEach((target, index) => {
    let low = 0
    let high = tails.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (targets[tails[middle]] < target) low = middle + 1
      else high = middle
    }
    previous[index] = low > 0 ? tails[low - 1] : -1
    tails[low] = index
  })
  const kept = new Set<number>()
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1
  while (cursor !== -1) {
    kept.add(cursor)
    cursor = previous[cursor]
  }
  const moved = new Set<number>()
  targets.forEach((_, index) => {
    if (!kept.has(index)) moved.add(index)
  })
  return moved
}
