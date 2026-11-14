import type { FieldRow, StructuralChange, TreeNode, TreeStatus } from '../types.ts'
import { alignItems, movedPositions } from './align.ts'
import { shownKey } from './ignore.ts'
import { similarity } from './textDiff.ts'
import { displayValue, isPlainObject, sortKeys, typeName } from './values.ts'

export type StructureOptions = {
  xml: boolean
  ignoreKeyOrder: boolean
  ignoreListOrder: boolean
  matchKeys: string[]
}

type Context = StructureOptions & {
  candidates: string[]
  used: Set<string>
  signatures: WeakMap<object, string>
}

const ID_KEYS = ['id', 'name', 'key', 'sku', 'email', 'path', '@_id', '@_sku', '@_name', '@_key']

// People type attribute keys as @id; the parsed XML stores them as @_id.
export function keyCandidates(matchKeys: string[]): string[] {
  const preferred = matchKeys.flatMap((key) => (key.startsWith('@') ? [`@_${key.slice(1)}`] : [key, `@_${key}`]))
  return [...new Set([...preferred, ...ID_KEYS])]
}

function idLabel(key: string): string {
  return key.startsWith('@_') ? key.slice(2) : key
}

function joinPath(parent: string, key: string): string {
  const shown = shownKey(key)
  return parent ? `${parent}.${shown}` : shown
}

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

export function identityKey(items: unknown[], candidates: string[] = ID_KEYS): string | null {
  if (items.length === 0 || !items.every(isPlainObject)) return null
  for (const key of candidates) {
    const ids = items.map((item) => item[key])
    if (!ids.every((id) => typeof id === 'string' || typeof id === 'number')) continue
    const texts = ids.map((id) => String(id))
    if (new Set(texts).size === texts.length) return key
  }
  return null
}

function stringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function signature(value: unknown, context: Context): string {
  if (value === null || typeof value !== 'object') return stringify(value)
  const cached = context.signatures.get(value)
  if (cached !== undefined) return cached
  const text = stringify(context.ignoreKeyOrder ? sortKeys(value) : value)
  context.signatures.set(value, text)
  return text
}

function plain(value: unknown): boolean {
  return value === null || typeof value !== 'object' || value instanceof Date
}

// Records that share most keys and values are the same item, edited.
function likeness(left: unknown, right: unknown, context: Context): number {
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    if (keys.size === 0) return 1
    let shared = 0
    let same = 0
    for (const key of keys) {
      if (!has(left, key) || !has(right, key)) continue
      shared += 1
      if (signature(left[key], context) === signature(right[key], context)) same += 1
    }
    return (shared + same) / (2 * keys.size)
  }
  if (Array.isArray(left) && Array.isArray(right)) return similarity(signature(left, context), signature(right, context))
  return 0
}

function alignXml(left: unknown, right: unknown): [unknown, unknown] {
  const canWrap = (value: unknown) => value !== null && value !== undefined && !Array.isArray(value)
  if (Array.isArray(left) && !Array.isArray(right) && canWrap(right)) return [left, [right]]
  if (Array.isArray(right) && !Array.isArray(left) && canWrap(left)) return [[left], right]
  return [left, right]
}

function isQuiet(node: TreeNode): boolean {
  return node.status === 'same' && !node.reordered
}

function rollup(children: TreeNode[]): TreeStatus {
  if (children.length === 0 || children.every((child) => isQuiet(child))) return 'same'
  if (children.every((child) => child.status === 'added')) return 'added'
  if (children.every((child) => child.status === 'removed')) return 'removed'
  if (children.every((child) => child.status === 'moved' || isQuiet(child)) && children.some((child) => child.status === 'moved')) {
    return 'moved'
  }
  return 'mixed'
}

function fromOneSide(value: unknown, key: string, path: string, id: string, status: 'added' | 'removed'): TreeNode {
  const children: TreeNode[] = []
  if (isPlainObject(value)) {
    for (const childKey of Object.keys(value)) {
      children.push(fromOneSide(value[childKey], shownKey(childKey), joinPath(path, childKey), joinPath(id, childKey), status))
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      children.push(fromOneSide(item, String(index), `${path}[${index}]`, `${id}[${index}]`, status))
    })
  }
  return {
    id,
    key,
    path,
    status,
    children,
    leftPreview: status === 'removed' ? displayValue(value) : undefined,
    rightPreview: status === 'added' ? displayValue(value) : undefined,
  }
}

function sameLeaf(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  return Object.is(left, right)
}

function markMoved(node: TreeNode, from: number, to: number) {
  node.note = `index ${from} → ${to}`
  if (node.status === 'same') node.status = 'moved'
}

function diffById(left: Record<string, unknown>[], right: Record<string, unknown>[], path: string, id: string, idKey: string, context: Context): TreeNode[] {
  const rightById = new Map<string, number>()
  right.forEach((item, index) => rightById.set(String(item[idKey]), index))
  const label = idLabel(idKey)
  const matched: { node: TreeNode; from: number; to: number }[] = []
  const nodes: TreeNode[] = []
  const seen = new Set<string>()

  left.forEach((item, index) => {
    const value = String(item[idKey])
    const itemPath = `${path}[${label}=${value}]`
    const itemId = `${id}[${label}=${value}]`
    const match = rightById.get(value)
    if (match === undefined) {
      nodes.push(fromOneSide(item, value, itemPath, itemId, 'removed'))
      return
    }
    seen.add(value)
    const node = build(item, right[match], value, itemPath, itemId, context)
    matched.push({ node, from: index, to: match })
    nodes.push(node)
  })

  if (!context.ignoreListOrder) {
    for (const position of movedPositions(matched.map((item) => item.to))) {
      const { node, from, to } = matched[position]
      markMoved(node, from, to)
    }
  }

  right.forEach((item) => {
    const value = String(item[idKey])
    if (seen.has(value)) return
    nodes.push(fromOneSide(item, value, `${path}[${label}=${value}]`, `${id}[${label}=${value}]`, 'added'))
  })
  return nodes
}

function diffByIndex(left: unknown[], right: unknown[], path: string, id: string, context: Context): TreeNode[] {
  const count = Math.max(left.length, right.length)
  const nodes: TreeNode[] = []
  for (let index = 0; index < count; index += 1) {
    const itemPath = `${path}[${index}]`
    const itemId = `${id}[${index}]`
    if (index >= left.length) nodes.push(fromOneSide(right[index], String(index), itemPath, itemId, 'added'))
    else if (index >= right.length) nodes.push(fromOneSide(left[index], String(index), itemPath, itemId, 'removed'))
    else nodes.push(build(left[index], right[index], String(index), itemPath, itemId, context))
  }
  return nodes
}

// Matched and added items carry their position in the after file. A removed item carries
// its position in the before file, so its id gets a marker to stay unique.
function diffBySequence(left: unknown[], right: unknown[], path: string, id: string, context: Context): TreeNode[] {
  const links = alignItems(
    left.map((item) => signature(item, context)),
    right.map((item) => signature(item, context)),
    {
      unordered: context.ignoreListOrder,
      positional: left.every(plain) && right.every(plain),
      likeness: (from, to) => likeness(left[from], right[to], context),
    },
  )
  if (!links) return diffByIndex(left, right, path, id, context)
  return links.map((link) => {
    if (link.right === undefined) {
      const from = link.left ?? 0
      return fromOneSide(left[from], String(from), `${path}[${from}]`, `${id}[-${from}]`, 'removed')
    }
    const to = link.right
    if (link.left === undefined) return fromOneSide(right[to], String(to), `${path}[${to}]`, `${id}[${to}]`, 'added')
    const node = build(left[link.left], right[to], String(to), `${path}[${to}]`, `${id}[${to}]`, context)
    if (link.moved) markMoved(node, link.left, to)
    return node
  })
}

function listChildren(left: unknown[], right: unknown[], path: string, id: string, context: Context): TreeNode[] {
  const leftKey = identityKey(left, context.candidates)
  const rightKey = identityKey(right, context.candidates)
  if (leftKey && leftKey === rightKey) {
    context.used.add(leftKey)
    return diffById(left as Record<string, unknown>[], right as Record<string, unknown>[], path, id, leftKey, context)
  }
  return diffBySequence(left, right, path, id, context)
}

function build(left: unknown, right: unknown, key: string, path: string, id: string, context: Context): TreeNode {
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left)
    const known = new Set(keys)
    for (const childKey of Object.keys(right)) if (!known.has(childKey)) keys.push(childKey)
    const children = keys.map((childKey) => {
      const childPath = joinPath(path, childKey)
      const childId = joinPath(id, childKey)
      if (!has(left, childKey)) return fromOneSide(right[childKey], shownKey(childKey), childPath, childId, 'added')
      if (!has(right, childKey)) return fromOneSide(left[childKey], shownKey(childKey), childPath, childId, 'removed')
      const [leftValue, rightValue] = context.xml ? alignXml(left[childKey], right[childKey]) : [left[childKey], right[childKey]]
      return build(leftValue, rightValue, shownKey(childKey), childPath, childId, context)
    })
    const node: TreeNode = {
      id,
      key,
      path,
      status: rollup(children),
      children,
      leftPreview: displayValue(left),
      rightPreview: displayValue(right),
    }
    if (!context.ignoreKeyOrder) {
      const leftShared = Object.keys(left).filter((childKey) => has(right, childKey))
      const rightShared = Object.keys(right).filter((childKey) => has(left, childKey))
      if (leftShared.join('\0') !== rightShared.join('\0')) node.reordered = true
    }
    return node
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const children = listChildren(left, right, path, id, context)
    return {
      id,
      key,
      path,
      status: rollup(children),
      children,
      leftPreview: displayValue(left),
      rightPreview: displayValue(right),
    }
  }

  const leaf = { id, key, path, children: [], leftPreview: displayValue(left), rightPreview: displayValue(right) }
  if (typeName(left) !== typeName(right)) return { ...leaf, status: 'changed', typeChange: true }
  return { ...leaf, status: sameLeaf(left, right) ? 'same' : 'changed' }
}

function walkChanges(node: TreeNode, acc: StructuralChange[], root = false): void {
  const id = node.id || 'root'
  const path = node.path || '(root)'
  if (node.reordered) {
    acc.push({ id: `${id}:order`, nodeId: node.id, path, kind: 'reordered', note: 'Key order changed' })
  }

  if (node.note) {
    acc.push({ id: `${id}:move`, nodeId: node.id, path, kind: 'moved', note: node.note, left: node.leftPreview, right: node.rightPreview })
    if (node.status === 'moved') return
  }

  if (node.children.length === 0) {
    if (node.status === 'same' || node.status === 'moved') return
    const kind = node.typeChange
      ? 'type'
      : node.status === 'added' || node.status === 'removed'
        ? node.status
        : 'changed'
    acc.push({ id, nodeId: node.id, path, kind, left: node.leftPreview, right: node.rightPreview })
    return
  }

  if (!root && (node.status === 'added' || node.status === 'removed')) {
    acc.push({ id, nodeId: node.id, path, kind: node.status, left: node.leftPreview, right: node.rightPreview })
    return
  }

  for (const child of node.children) walkChanges(child, acc, false)
}

function walkFields(node: TreeNode, acc: FieldRow[], root = false): void {
  const id = node.id || 'root'
  const path = node.path || '(root)'
  if (node.reordered) {
    acc.push({ id: `${id}:order`, path, status: 'changed', note: 'Key order changed', reordered: true })
  }
  if (node.children.length === 0) {
    acc.push({
      id,
      path,
      status: node.status,
      left: node.leftPreview,
      right: node.rightPreview,
      note: node.note,
      typeChange: node.typeChange,
    })
    return
  }
  if (!root && node.note) {
    acc.push({ id: `${id}:move`, path, status: 'moved', note: node.note, left: node.leftPreview, right: node.rightPreview })
  }
  for (const child of node.children) walkFields(child, acc, false)
}

export type Structure = {
  tree: TreeNode
  changes: StructuralChange[]
  fields: FieldRow[]
  usedKeys: string[]
}

export function buildStructure(left: unknown, right: unknown, options: StructureOptions): Structure | null {
  if (left === undefined && right === undefined) return null
  const context: Context = { ...options, candidates: keyCandidates(options.matchKeys), used: new Set(), signatures: new WeakMap() }
  const tree = left === undefined
    ? fromOneSide(right, '(root)', '', '', 'added')
    : right === undefined
      ? fromOneSide(left, '(root)', '', '', 'removed')
      : build(left, right, '(root)', '', '', context)
  const changes: StructuralChange[] = []
  const fields: FieldRow[] = []
  walkChanges(tree, changes, true)
  walkFields(tree, fields, true)
  return { tree, changes, fields, usedKeys: [...context.used].map(idLabel) }
}

// Puts every list in a stable order, by its id when the items have one, so the formatted
// text lines up the same way the structure does.
export function sortLists(value: unknown, matchKeys: string[]): unknown {
  const candidates = keyCandidates(matchKeys)
  const collator = new Intl.Collator(undefined, { numeric: true })
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const items = node.map(walk)
      const key = identityKey(items, candidates)
      const keyed = items.map((item) => ({
        item,
        order: key && isPlainObject(item) ? String(item[key]) : stringify(isPlainObject(item) || Array.isArray(item) ? sortKeys(item) : item),
      }))
      keyed.sort((a, b) => collator.compare(a.order, b.order))
      return keyed.map((entry) => entry.item)
    }
    if (!isPlainObject(node)) return node
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) out[key] = walk(child)
    return out
  }
  return walk(value)
}
