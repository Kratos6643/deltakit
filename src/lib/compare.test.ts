import { applyPatch } from 'diff'
import { describe, expect, it } from 'vitest'
import { compare } from './compare.ts'
import { parseCsv } from './csv.ts'
import { beautifyXml, formatSource } from './format.ts'
import { alignLines } from './textDiff.ts'
import type { ChangeKind, CompareOptions } from '../types.ts'

const fixtures = {
  json: {
    leftName: 'billing.before.json',
    rightName: 'billing.after.json',
    left: `${JSON.stringify({
      service: 'billing',
      version: '2.4.1',
      region: 'us-east-1',
      features: { invoices: true, tax: false, retries: 3, currency: 'USD' },
      endpoints: [
        { name: 'charge', path: '/v1/charge', timeoutMs: 2000 },
        { name: 'refund', path: '/v1/refund', timeoutMs: 3000 },
        { name: 'status', path: '/v1/status', timeoutMs: 500 },
      ],
      owners: ['ava', 'noah'],
      legacy: { soap: true },
    }, null, 2)}\n`,
    right: `${JSON.stringify({
      service: 'billing',
      version: '2.5.0',
      region: 'eu-central-1',
      features: { invoices: true, tax: true, retries: '3', webhooks: true },
      endpoints: [
        { name: 'refund', path: '/v2/refund', timeoutMs: 3500 },
        { name: 'charge', path: '/v1/charge', timeoutMs: 2000 },
        { name: 'capture', path: '/v1/capture', timeoutMs: 2500 },
      ],
      owners: ['ava', 'noah', 'mia'],
      notes: null,
    }, null, 2)}\n`,
  },
  yaml: {
    leftName: 'deploy.before.yaml',
    rightName: 'deploy.after.yaml',
    left: `service: billing
version: 2.4.1
region: us-east-1
features:
  invoices: true
  tax: false
  retries: 3
replicas: 2
env:
  LOG_LEVEL: info
`,
    right: `service: billing
version: 2.5.0
region: eu-central-1
features:
  invoices: true
  tax: true
  retries: "3"
  webhooks: true
replicas: 4
env:
  LOG_LEVEL: debug
  REGION_FALLBACK: us-east-1
`,
  },
  csv: {
    leftName: 'team.before.csv',
    rightName: 'team.after.csv',
    left: `id, name, role, city, active
1, Ava Shah, admin, Austin, true
2, Noah Kim, editor, Seattle, true
3, Mia Rossi, viewer, Rome, false
4, Leo Park, editor, Busan, true
`,
    right: `id,name,role,city,active,team
1,Ava Shah,owner,Austin,true,core
2,Noah Kim,editor,Portland,true,core
4,Leo Park,editor,Busan,false,growth
5,Ivy Chen,viewer,Taipei,true,growth
`,
  },
  text: {
    left: `Release notes 2.4
April 2, 2026

Billing retries a failed charge three times.
Invoices go out in USD.
The service runs in us-east-1.
Owners: Ava and Noah.
The legacy SOAP endpoint stays available.
Status checks time out after 500 ms.
`,
    right: `Release notes 2.5
October 12, 2026

Billing retries a failed charge five times.
Invoices go out in USD and EUR.
The service runs in eu-central-1, with us-east-1 as fallback.
Owners: Ava, Noah, and Mia.
The legacy SOAP endpoint has been removed.
Webhooks fire after every capture.
Status checks time out after 800 ms.
`,
  },
}

const options: CompareOptions = {
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

function kinds(paths: { kind: ChangeKind; path: string }[]) {
  return paths.map((item) => `${item.kind} ${item.path}`)
}

describe('text diff', () => {
  it('reports line adds, removes, and modifications', () => {
    const result = compare('text', 'alpha\nkeep\ngone\n', 'alpha\nkept\n\nextra\n', 'a.txt', 'b.txt', options)
    expect(result.stats.unchangedLines).toBe(1)
    expect(result.stats.modifiedLines).toBe(1)
    expect(result.stats.removedLines).toBe(1)
    expect(result.stats.addedLines).toBe(2)
    expect(result.hunks.length).toBeGreaterThan(0)
    expect(result.patch).toContain('--- a.txt')
    expect(result.patch).toContain('+++ b.txt')
  })

  it('ignores surrounding whitespace when asked', () => {
    const result = compare('text', 'alpha  \n', 'alpha\n', 'a.txt', 'b.txt', options)
    expect(result.stats.similarity).toBe(100)
    expect(result.rows[0]?.fuzzy).toBe(true)
  })

  it('sorts lines so a move is not a difference', () => {
    const moved = compare('text', 'bravo\nalpha\ncharlie\n', 'charlie\nalpha\nbravo\n', 'a.txt', 'b.txt', options)
    const sorted = compare('text', 'bravo\nalpha\ncharlie\n', 'charlie\nalpha\nbravo\n', 'a.txt', 'b.txt', { ...options, sortLines: true })
    expect(moved.stats.similarity).toBeLessThan(100)
    expect(sorted.stats.similarity).toBe(100)
    expect(sorted.hunks).toEqual([])
    expect(sorted.rows.every((row) => row.leftNo === undefined && row.rightNo === undefined)).toBe(true)
  })

  it('after sorting, reports only lines that are missing or extra', () => {
    const result = compare('text', 'b\na\n', 'c\na\n', 'a.txt', 'b.txt', { ...options, sortLines: true })
    expect(result.stats.unchangedLines).toBe(1)
    expect(result.stats.removedLines).toBe(1)
    expect(result.stats.addedLines).toBe(1)
    expect(result.rows.filter((row) => row.kind === 'remove').map((row) => row.left)).toEqual(['b'])
    expect(result.rows.filter((row) => row.kind === 'add').map((row) => row.right)).toEqual(['c'])
  })

  it('treats case changes as real edits unless ignore case is on', () => {
    const sensitive = compare('text', 'Alpha\n', 'alpha\n', 'a.txt', 'b.txt', options)
    const ignored = compare('text', 'Alpha\n', 'alpha\n', 'a.txt', 'b.txt', { ...options, ignoreCase: true })
    expect(sensitive.stats.modifiedLines).toBe(1)
    expect(ignored.stats.similarity).toBe(100)
  })

  it('pairs each changed line with its closest match inside a block', () => {
    const before = 'intro\nOwners: Ava and Noah.\nStatus checks time out after 500 ms.\n'
    const after = 'intro\nOwners: Ava, Noah, and Mia.\nWebhooks fire after every capture.\nStatus checks time out after 800 ms.\n'
    const result = compare('text', before, after, 'a.txt', 'b.txt', options)
    expect(result.rows.filter((row) => row.kind === 'modify').map((row) => [row.left, row.right])).toEqual([
      ['Owners: Ava and Noah.', 'Owners: Ava, Noah, and Mia.'],
      ['Status checks time out after 500 ms.', 'Status checks time out after 800 ms.'],
    ])
    expect(result.rows.filter((row) => row.kind === 'add').map((row) => row.right)).toEqual(['Webhooks fire after every capture.'])
    expect(applyPatch(before, result.patch)).toBe(after)
  })

  it('keeps unrelated replacement lines side by side', () => {
    const result = compare('text', 'keep\nred apple\n', 'keep\nblue sky\n', 'a.txt', 'b.txt', options)
    expect(result.rows.map((row) => row.kind)).toEqual(['equal', 'modify'])
  })

  it('measures how much of the text matches', () => {
    const result = compare('text', fixtures.text.left, fixtures.text.right, 'a.txt', 'b.txt', options)
    expect(result.stats.similarity).toBeLessThan(20)
    expect(result.stats.textMatch).toBeGreaterThan(60)
    expect(compare('text', 'same\n', 'same\n', 'a.txt', 'b.txt', options).stats.textMatch).toBe(100)
  })
})

describe('json', () => {
  it('finds value, type, move, add, and remove changes', () => {
    const sample = fixtures.json
    const result = compare('json', sample.left, sample.right, sample.leftName, sample.rightName, options)
    const labels = kinds(result.changes)
    expect(labels).toContain('changed version')
    expect(labels).toContain('changed region')
    expect(labels).toContain('changed features.tax')
    expect(labels).toContain('type features.retries')
    expect(labels).toContain('removed features.currency')
    expect(labels).toContain('added features.webhooks')
    expect(labels).toContain('moved endpoints[name=charge]')
    expect(labels).toContain('changed endpoints[name=refund].path')
    expect(labels).toContain('changed endpoints[name=refund].timeoutMs')
    expect(labels).toContain('removed endpoints[name=status]')
    expect(labels).toContain('added endpoints[name=capture]')
    expect(labels).toContain('added owners[2]')
    expect(labels).toContain('removed legacy')
    expect(labels).toContain('added notes')
    expect(result.leftError).toBeUndefined()
    expect(result.grid?.path).toBe('endpoints')
    expect(result.stats.fieldMatch).not.toBeNull()
  })

  it('ignores spacing and key order in canonical mode', () => {
    const result = compare(
      'json',
      '{"a":1,"b":2}',
      '{\n  "b": 2,\n  "a": 1\n}',
      'a.json',
      'b.json',
      options,
    )
    expect(result.stats.similarity).toBe(100)
    expect(result.changes).toEqual([])
  })

  it('can still surface key order', () => {
    const result = compare(
      'json',
      '{"a":1,"b":2}',
      '{"b":2,"a":1}',
      'a.json',
      'b.json',
      { ...options, ignoreKeyOrder: false },
    )
    expect(result.changes.some((change) => change.kind === 'reordered')).toBe(true)
  })

  it('keeps a text diff when JSON is invalid', () => {
    const result = compare('json', '{"ok":true}', '{"ok": ', 'a.json', 'b.json', options)
    expect(result.rightError).toMatch(/Invalid JSON/)
    expect(result.tree).toBeNull()
    expect(result.rows.length).toBeGreaterThan(0)
  })
})

describe('xml, yaml, and csv', () => {
  it('aligns a single XML element with a repeated element', () => {
    const result = compare(
      'xml',
      '<wrap><item id="1">A</item></wrap>',
      '<wrap><item id="1">B</item><item id="2">C</item></wrap>',
      'a.xml',
      'b.xml',
      options,
    )
    const labels = kinds(result.changes)
    expect(labels).toContain('changed wrap.item[id=1].text')
    expect(labels).toContain('added wrap.item[id=2]')
  })

  it('preserves attributes while beautifying XML', () => {
    const pretty = beautifyXml('<price currency="USD">1.20</price>')
    expect(pretty).toContain('currency="USD"')
    expect(pretty).toContain('1.20')
    expect(pretty).toContain('\n')
  })

  it('keeps attribute values of true and reports broken XML', () => {
    expect(beautifyXml('<order paid="true"/>')).toContain('paid="true"')
    expect(() => formatSource('xml', '<a><b>1</a>', 'pretty')).toThrow(/line 1/)
    const result = compare('xml', '<a><b>1</a>', '<a><b>1</b></a>', 'a.xml', 'b.xml', options)
    expect(result.leftError).toMatch(/Invalid XML/)
    expect(result.rightError).toBeUndefined()
  })

  it('reads YAML as data, beyond its text', () => {
    const sample = fixtures.yaml
    const result = compare('yaml', sample.left, sample.right, sample.leftName, sample.rightName, options)
    const labels = kinds(result.changes)
    expect(labels).toContain('changed version')
    expect(labels).toContain('type features.retries')
    expect(labels).toContain('added features.webhooks')
    expect(labels).toContain('added env.REGION_FALLBACK')
    expect(result.stats.similarity).toBeLessThan(100)
  })

  it('diffs CSV cells, columns, and rows', () => {
    const sample = fixtures.csv
    const result = compare('csv', sample.left, sample.right, sample.leftName, sample.rightName, options)
    const grid = result.grid
    expect(grid?.columns.some((column) => column.name === 'team' && column.status === 'added')).toBe(true)
    const mia = grid?.rows.find((row) => row.label === '3')
    const ivy = grid?.rows.find((row) => row.label === '5')
    const ava = grid?.rows.find((row) => row.label === '1')
    expect(mia?.status).toBe('removed')
    expect(ivy?.status).toBe('added')
    expect(ava?.status).toBe('changed')
    expect(ava?.cells.find((cell) => cell.before === 'admin')?.text).toBe('owner')
  })

  it('parses quoted CSV commas', () => {
    expect(parseCsv('id,name\n1,"Doe, Jane"\n', true)).toEqual([
      ['id', 'name'],
      ['1', 'Doe, Jane'],
    ])
  })
})

describe('patch', () => {
  const exact = { ...options, ignoreWhitespace: false }

  function random(seed: number) {
    let state = seed
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state / 2147483648
    }
  }

  function edit(lines: string[], next: () => number): string[] {
    const out: string[] = []
    for (const line of lines) {
      const roll = next()
      if (roll < 0.12) continue
      if (roll < 0.24) out.push(`${line} edited`)
      else out.push(line)
      if (next() < 0.1) out.push(`inserted ${Math.floor(next() * 1000)}`)
    }
    return out
  }

  it('applies cleanly to the before text', () => {
    const cases: [string, string][] = [
      ['a\nb\nc\n', 'a\nB\nc\nd\n'],
      ['', 'new\n'],
      ['old\n', ''],
      ['a\nb', 'a\nb\n'],
      ['a\nb\n', 'a\nb'],
      ['a\nb', 'a\nb\nc'],
      ['keep\nlast', 'keep\nlast changed'],
    ]
    for (let seed = 1; seed <= 40; seed += 1) {
      const next = random(seed)
      const before = Array.from({ length: 5 + Math.floor(next() * 60) }, (_, index) => `line ${index}`)
      const after = edit(before, next)
      const tail = next() < 0.3 ? '' : '\n'
      cases.push([`${before.join('\n')}\n`, `${after.join('\n')}${tail}`])
    }
    for (const [before, after] of cases) {
      const result = compare('text', before, after, 'a.txt', 'b.txt', exact)
      if (before === after) continue
      expect(applyPatch(before, result.patch), JSON.stringify({ before, after, patch: result.patch })).toBe(after)
    }
  })

  it('is empty when nothing changed', () => {
    expect(compare('text', 'same\n', 'same\n', 'a.txt', 'b.txt', exact).patch).toBe('')
  })
})

describe('large and very different files', () => {
  it('falls back to anchored matching instead of hanging', () => {
    const left = Array.from({ length: 3000 }, (_, index) => `left ${index} ${index * 7}`).join('\n')
    const right = Array.from({ length: 3000 }, (_, index) => `right ${index} ${index * 13}`).join('\n')
    const { rows, approximate } = alignLines(left, right, { ignoreWhitespace: true, ignoreCase: false, timeout: 1 })
    expect(approximate).toBe(true)
    expect(rows.length).toBe(3000)
    expect(rows.every((row) => row.kind === 'modify')).toBe(true)
  })

  it('keeps unchanged lines aligned when the fallback runs', () => {
    const lines = Array.from({ length: 20_000 }, (_, index) => `entry ${index}`)
    const moved = [...lines.slice(5000), ...lines.slice(0, 5000)]
    moved[7000] = 'entry 12000 edited'
    const { rows, approximate } = alignLines(`${lines.join('\n')}\n`, `${moved.join('\n')}\n`, { ignoreWhitespace: true, ignoreCase: false, timeout: 1 })
    expect(approximate).toBe(true)
    expect(rows.filter((row) => row.kind === 'equal').length).toBe(14_999)
    expect(rows.filter((row) => row.kind === 'modify').map((row) => row.right)).toEqual(['entry 12000 edited'])
  })

  it('finishes two very different 20,000-line files quickly', () => {
    const left = Array.from({ length: 20_000 }, (_, index) => `alpha ${index} ${(index * 31) % 977}`).join('\n')
    const right = Array.from({ length: 20_000 }, (_, index) => `bravo ${index} ${(index * 17) % 991}`).join('\n')
    const started = performance.now()
    const result = compare('text', left, right, 'a.txt', 'b.txt', options)
    expect(performance.now() - started).toBeLessThan(8000)
    expect(result.approximate).toBe(true)
    expect(result.stats.modifiedLines).toBe(20_000)
    expect(result.patch.startsWith('--- a.txt\n+++ b.txt\n@@ -1,20000 +1,20000 @@')).toBe(true)
  }, 20_000)

  it('handles objects with many keys', () => {
    const wide = (tweak: boolean) => JSON.stringify(Object.fromEntries(Array.from({ length: 50_000 }, (_, index) => [`key_${index}`, tweak && index % 500 === 0 ? 'x' : index])))
    const started = performance.now()
    const result = compare('json', wide(false), wide(true), 'a.json', 'b.json', options)
    expect(performance.now() - started).toBeLessThan(8000)
    expect(result.changes.filter((change) => change.kind === 'type').length).toBe(100)
  }, 20_000)
})

describe('formatting', () => {
  it('beautifies, minifies, and sorts JSON', () => {
    expect(formatSource('json', '{"b":1,"a":2}', 'pretty')).toBe('{\n  "b": 1,\n  "a": 2\n}\n')
    expect(formatSource('json', '{\n  "a": 1\n}\n', 'minify')).toBe('{"a":1}')
    expect(formatSource('json', '{"b":1,"a":2}', 'sort')).toBe('{\n  "a": 2,\n  "b": 1\n}\n')
  })

  it('tidies trailing whitespace', () => {
    expect(formatSource('text', 'alpha   \r\nbeta', 'tidy')).toBe('alpha\nbeta\n')
  })
})
