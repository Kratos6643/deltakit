import { describe, expect, it } from 'vitest'
import { compare } from './compare.ts'
import { detectDelimiter, parseCsv } from './csv.ts'
import { formatSource } from './format.ts'
import { TEXT_PRESETS } from './ignore.ts'
import type { CompareOptions, TreeNode } from '../types.ts'

const base: CompareOptions = {
  ignoreWhitespace: true,
  ignoreCase: false,
  ignoreFormatting: true,
  ignoreKeyOrder: true,
  sortLines: false,
  ignoreListOrder: false,
  delimiter: 'auto',
  ignoreFields: [],
  ignoreText: [],
  matchKeys: [],
}

function json(left: unknown, right: unknown, options: Partial<CompareOptions> = {}) {
  return compare('json', JSON.stringify(left, null, 2), JSON.stringify(right, null, 2), 'a.json', 'b.json', { ...base, ...options })
}

function labels(result: ReturnType<typeof compare>) {
  return result.changes.map((change) => `${change.kind} ${change.path}`)
}

function ids(node: TreeNode, out: string[] = []): string[] {
  out.push(node.id)
  for (const child of node.children) ids(child, out)
  return out
}

describe('CSV separators', () => {
  it('detects semicolons, tabs, pipes, and commas', () => {
    expect(detectDelimiter('a;b;c\n1;2,5;3\n')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2\n')).toBe('\t')
    expect(detectDelimiter('a|b|c\n1|2|3\n')).toBe('|')
    expect(detectDelimiter('a,b\n"x;y",2\n')).toBe(',')
  })

  it('compares a semicolon file with a comma file by their data', () => {
    const result = compare('csv', 'id;name\n1;Ava\n2;Noah\n', 'id,name\n1,Ava\n2,Noah\n', 'a.csv', 'b.csv', base)
    expect(result.hunks).toEqual([])
    expect(result.grid?.rows.every((row) => row.status === 'same')).toBe(true)
    expect(result.delimiters).toEqual({ left: ';', right: ',' })
  })

  it('splits on the separator chosen in Options', () => {
    const forced = compare('csv', 'id;name\n1;Ava\n', 'id;name\n1;Ava\n', 'a.csv', 'b.csv', { ...base, delimiter: ',' })
    expect(forced.grid?.columns.map((column) => column.name)).toEqual(['id;name'])
  })

  it('keeps the separator when normalizing', () => {
    expect(formatSource('csv', 'a; b\n"x";y\n', 'pretty')).toBe('a;b\nx;y\n')
    expect(parseCsv('a\tb\n1\t"2\t3"\n', true, '\t')).toEqual([['a', 'b'], ['1', '2\t3']])
  })

  it('matches rows by a chosen key column, in any letter case', () => {
    const left = 'code,name\nA1,Ava\nB2,Noah\n'
    const right = 'code,name\nA1,Ava Shah\nB2,Noah\n'
    const automatic = compare('csv', left, right, 'a.csv', 'b.csv', base)
    expect(automatic.grid?.key).toBe('name')
    expect(automatic.grid?.rows.filter((row) => row.status === 'added').length).toBe(1)
    const chosen = compare('csv', left, right, 'a.csv', 'b.csv', { ...base, matchKeys: ['CODE'] })
    expect(chosen.grid?.key).toBe('code')
    expect(chosen.grid?.rows.find((row) => row.label === 'A1')?.status).toBe('changed')
    expect(compare('csv', 'ID,City\n1,Rome\n', 'ID,City\n1,Oslo\n', 'a.csv', 'b.csv', base).grid?.key).toBe('ID')
  })
})

describe('ignored fields', () => {
  const before = { id: 7, updatedAt: '2026-01-01', meta: { requestId: 'r1', version: 2 }, items: [{ sku: 'x', ts: 1 }] }
  const after = { id: 7, updatedAt: '2026-02-02', meta: { requestId: 'r2', version: 2 }, items: [{ sku: 'x', ts: 2 }] }

  it('leaves out matching fields everywhere', () => {
    const result = json(before, after, { ignoreFields: ['updatedAt', 'meta.requestId', 'items[*].ts'] })
    expect(result.changes).toEqual([])
    expect(result.hunks).toEqual([])
    expect(result.info).toEqual(['Ignored fields: updatedAt, meta.requestId, and items.ts.'])
  })

  it('supports * as a wildcard and reports when nothing matches', () => {
    const result = json({ createdAt: 1, updatedAt: 2, v: 1 }, { createdAt: 3, updatedAt: 4, v: 1 }, { ignoreFields: ['*At'] })
    expect(result.changes).toEqual([])
    expect(json(before, after, { ignoreFields: ['missing'] }).info).toEqual(['No field matches “missing”, so nothing was left out.'])
  })

  it('ignores XML attributes and CSV columns', () => {
    const xml = compare('xml', '<a stamp="1"><b>x</b></a>', '<a stamp="2"><b>x</b></a>', 'a.xml', 'b.xml', { ...base, ignoreFields: ['stamp'] })
    expect(xml.changes).toEqual([])
    const csv = compare('csv', 'id,name,updated\n1,Ava,mon\n', 'id,name,updated\n1,Ava,tue\n', 'a.csv', 'b.csv', { ...base, ignoreFields: ['updated'] })
    expect(csv.grid?.columns.map((column) => column.name)).toEqual(['id', 'name'])
    expect(csv.hunks).toEqual([])
    expect(csv.info).toEqual(['Ignored column: updated.'])
  })
})

describe('ignored text', () => {
  const dates = TEXT_PRESETS.find((preset) => preset.id === 'dates')?.pattern ?? ''

  it('compares lines without the matching text', () => {
    const result = compare('text', '2026-11-13T10:00:00Z started job 4\n', '2026-11-14T11:30:05.120Z started job 4\n', 'a.log', 'b.log', { ...base, ignoreText: [dates] })
    expect(result.stats.similarity).toBe(100)
    expect(result.rows[0]?.fuzzy).toBe(true)
    expect(result.info).toEqual(['Ignored matching text on 2 lines.'])
  })

  it('skips patterns that are not valid', () => {
    const result = compare('text', 'a\n', 'b\n', 'a.txt', 'b.txt', { ...base, ignoreText: ['('] })
    expect(result.stats.modifiedLines).toBe(1)
    expect(result.info).toEqual([])
  })
})

describe('lists', () => {
  it('lines up plain lists by value, so an insert shifts nothing', () => {
    expect(labels(json({ owners: ['ava', 'noah'] }, { owners: ['zoe', 'ava', 'noah'] }))).toEqual(['added owners[0]'])
    expect(labels(json({ owners: ['x', 'ava', 'noah'] }, { owners: ['ava', 'noah'] }))).toEqual(['removed owners[0]'])
    expect(labels(json([1, 2, 3], [1, 5, 3]))).toEqual(['changed [1]'])
  })

  it('reports a moved item once and keeps node ids unique', () => {
    const moved = json(['a', 'b', 'c'], ['c', 'a', 'b'])
    expect(labels(moved)).toEqual(['moved [0]'])
    expect(moved.changes[0]?.note).toBe('index 2 → 0')
    const tangled = json(['x', 'y', 'a'], ['a', 'z', 'w'])
    const all = ids(tangled.tree as TreeNode)
    expect(new Set(all).size).toBe(all.length)
    expect(tangled.fields.length).toBe(new Set(tangled.fields.map((field) => field.id)).size)
  })

  it('pairs records without an id by what they share', () => {
    const result = json(
      [{ color: 'red', size: 1 }, { color: 'blue', size: 2 }],
      [{ color: 'green', size: 0 }, { color: 'red', size: 1 }, { color: 'blue', size: 3 }],
    )
    expect(labels(result)).toEqual(['added [0]', 'changed [2].size'])
  })

  it('marks only the items that left their order as moved', () => {
    const before = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(labels(json(before, [{ id: 'z' }, ...before]))).toEqual(['added [id=z]'])
    expect(labels(json(before, [{ id: 'b' }, { id: 'c' }, { id: 'a' }]))).toEqual(['moved [id=a]'])
  })

  it('can ignore list order entirely', () => {
    expect(json([1, 2, 3], [3, 1, 2], { ignoreListOrder: true }).changes).toEqual([])
    const keyed = json([{ id: 'a', v: 1 }, { id: 'b', v: 2 }], [{ id: 'b', v: 2 }, { id: 'a', v: 1 }], { ignoreListOrder: true })
    expect(keyed.changes).toEqual([])
    expect(keyed.hunks).toEqual([])
    const rows = compare('csv', 'id,v\n1,a\n2,b\n', 'id,v\n2,b\n1,a\n', 'a.csv', 'b.csv', { ...base, ignoreListOrder: true })
    expect(rows.grid?.rows.every((row) => row.status === 'same')).toBe(true)
    expect(rows.hunks).toEqual([])
  })

  it('matches items by a chosen key', () => {
    const before = [{ code: 'A', name: 'x' }, { code: 'B', name: 'y' }]
    const after = [{ code: 'A', name: 'x2' }, { code: 'B', name: 'y' }]
    expect(labels(json(before, after))).toEqual(['removed [name=x]', 'added [name=x2]'])
    expect(labels(json(before, after, { matchKeys: ['code'] }))).toEqual(['changed [code=A].name'])
    expect(json(before, after, { matchKeys: ['uuid'] }).info).toEqual(['Items were matched automatically, since no list has a unique “uuid” on every item.'])
    expect(json(before, after).keyChoices).toEqual(['code', 'name'])
  })

  it('matches XML elements by an attribute', () => {
    const result = compare(
      'xml',
      '<list><item code="A" label="x"/><item code="B" label="y"/></list>',
      '<list><item code="B" label="y"/><item code="A" label="z"/></list>',
      'a.xml',
      'b.xml',
      { ...base, matchKeys: ['code'] },
    )
    expect(labels(result)).toContain('changed list.item[code=A].@label')
  })
})
