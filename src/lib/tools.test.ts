import { describe, expect, it } from 'vitest'
import { compare } from './compare.ts'
import { convert } from './convert.ts'
import { decodeBase64, decodeJwt, decodeUrl, encodeBase64, encodeUrl, sniffEncoding } from './decode.ts'
import { buildHtmlReport } from './report.ts'
import type { CompareInput, CompareOptions } from '../types.ts'

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

function base64url(value: unknown): string {
  return encodeBase64(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('convert', () => {
  it('turns JSON into YAML and back', () => {
    expect(convert('json', 'yaml', '{"a":1,"b":[1,2]}').output).toBe('a: 1\nb:\n  - 1\n  - 2\n')
    expect(JSON.parse(convert('yaml', 'json', 'a: 1\nb: [x, y]\n').output)).toEqual({ a: 1, b: ['x', 'y'] })
  })

  it('keeps XML attributes through a round trip', () => {
    const json = JSON.parse(convert('xml', 'json', '<?xml version="1.0"?><book id="7"><title>T</title></book>').output)
    expect(json).toEqual({ book: { '@id': '7', title: 'T' } })
    const xml = convert('json', 'xml', JSON.stringify(json)).output
    expect(xml).toContain('<book id="7">')
    expect(xml).toContain('<title>T</title>')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('writes true and false attributes with their values', () => {
    const json = convert('xml', 'json', '<order paid="true" void="false"/>').output
    expect(convert('json', 'xml', json).output).toContain('<order paid="true" void="false"/>')
  })

  it('gives XML one root and valid names', () => {
    const wrapped = convert('json', 'xml', '{"a":1,"b":2}')
    expect(wrapped.output).toContain('<root>')
    expect(wrapped.notes[0]).toMatch(/one element at the top/)
    const renamed = convert('json', 'xml', '{"doc":{"1st":"x","a b":2}}')
    expect(renamed.output).toContain('<_1st>x</_1st>')
    expect(renamed.output).toContain('<a_b>2</a_b>')
    expect(renamed.notes.join(' ')).toMatch(/Renamed 2 keys/)
  })

  it('flattens records into CSV columns', () => {
    const result = convert('json', 'csv', '[{"id":1,"tags":["a"],"address":{"city":"X"}},{"id":2,"note":"b, c"}]')
    expect(result.output).toBe('id,tags,address.city,note\n1,"[""a""]",X,\n2,,,"b, c"\n')
    const nested = convert('json', 'csv', '{"meta":{"n":1},"items":[{"a":1},{"a":2}]}')
    expect(nested.output).toBe('a\n1\n2\n')
    expect(nested.notes[0]).toBe('Used the list at “items”, the largest one in the file.')
  })

  it('reads CSV with its own separator and safe value types', () => {
    const result = convert('csv', 'json', 'id;price;code;ok;when\n1;1.5;007;true;1.50\n')
    expect(JSON.parse(result.output)).toEqual([{ id: 1, price: 1.5, code: '007', ok: true, when: '1.50' }])
    expect(result.notes[0]).toMatch(/separated by semicolons/)
  })

  it('brings nested fields and lists back from CSV', () => {
    const source = [{ id: 1, tags: ['a', 'b'], address: { city: 'X', geo: { lat: 1 } } }]
    const csv = convert('json', 'csv', JSON.stringify(source)).output
    const back = convert('csv', 'json', csv)
    expect(JSON.parse(back.output)).toEqual(source)
    expect(back.notes.join(' ')).toMatch(/became nested fields/)
    const clash = convert('csv', 'json', 'a,a.b,note\n1,2,[x\n')
    expect(JSON.parse(clash.output)).toEqual([{ a: 1, 'a.b': 2, note: '[x' }])
  })

  it('turns repeated XML elements into CSV rows', () => {
    const result = convert('xml', 'csv', '<books><book id="1"><t>A</t></book><book id="2"><t>B</t></book></books>')
    expect(result.output).toBe('id,t\n1,A\n2,B\n')
  })

  it('reads multi-document YAML as a list and reports bad input', () => {
    const result = convert('yaml', 'json', 'a: 1\n---\na: 2\n')
    expect(JSON.parse(result.output)).toEqual([{ a: 1 }, { a: 2 }])
    expect(result.notes[0]).toMatch(/2 documents/)
    expect(() => convert('json', 'yaml', '{"a":')).toThrow(/Invalid JSON/)
    expect(() => convert('xml', 'json', '<a><b></a>')).toThrow(/Invalid XML at line 1/)
  })
})

describe('decode', () => {
  const now = Date.UTC(2026, 10, 13, 12, 0, 0)
  const header = base64url({ alg: 'HS256', typ: 'JWT' })

  it('reads a JWT and its expiry', () => {
    const token = `${header}.${base64url({ sub: '123', iat: now / 1000 - 60, exp: now / 1000 + 7200 })}.c2lnbmF0dXJl`
    const result = decodeJwt(`Bearer ${token}`, now)
    expect(JSON.parse(result.output)).toEqual({ header: { alg: 'HS256', typ: 'JWT' }, payload: { sub: '123', iat: now / 1000 - 60, exp: now / 1000 + 7200 } })
    expect(result.facts.find((fact) => fact.label === 'Expires')?.tone).toBe('good')
    expect(result.title).toBe('Valid, expires in 2 hours')
  })

  it('flags an expired or unsigned token', () => {
    const expired = decodeJwt(`${header}.${base64url({ exp: now / 1000 - 86_400 })}.c2ln`, now)
    expect(expired.title).toBe('Expired yesterday')
    expect(expired.facts.find((fact) => fact.label === 'Expires')?.tone).toBe('bad')
    const unsigned = decodeJwt(`${base64url({ alg: 'none' })}.${base64url({ a: 1 })}.`, now)
    expect(unsigned.notes[0]).toMatch(/no signature/)
    expect(() => decodeJwt('not a token')).toThrow(/three parts/)
  })

  it('decodes Base64 text, URL-safe Base64, and data URLs', () => {
    expect(decodeBase64('SGVsbG8sIHdvcmxkIQ==').output).toBe('Hello, world!')
    const unicode = 'héllo ✓ 👋'
    expect(decodeBase64(encodeBase64(unicode)).output).toBe(unicode)
    expect(decodeBase64(encodeBase64('<<???>>').replace(/\+/g, '-').replace(/\//g, '_')).output).toBe('<<???>>')
    expect(decodeBase64('data:text/plain;base64,SGk=').output).toBe('Hi')
    expect(() => decodeBase64('not base64!')).toThrow(/has “!”/)
    expect(() => decodeBase64('ab=cd')).toThrow(/has “=”/)
  })

  it('recognizes binary data', () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d))
    const result = decodeBase64(png)
    expect(result.binary?.label).toBe('PNG image')
    expect(result.binary?.mime).toBe('image/png')
    expect(result.output.startsWith('00000000  89 50 4e 47')).toBe(true)
  })

  it('decodes URLs, query strings, and broken codes', () => {
    const plain = decodeUrl('a%20b%2Bc+d')
    expect(plain.output).toBe('a b+c d')
    expect(plain.notes[0]).toMatch(/Plus signs/)
    const link = decodeUrl('https://x.test/p%20q?name=A%26B&x=1#top')
    expect(link.params).toEqual([['name', 'A&B'], ['x', '1']])
    expect(link.facts.map((fact) => `${fact.label}: ${fact.value}`)).toEqual(['Address: https://x.test', 'Path: /p q', 'Fragment: top', 'Query: 2 parameters'])
    expect(decodeUrl('?a=1&b=two%20words').params).toEqual([['a', '1'], ['b', 'two words']])
    const broken = decodeUrl('ok%20then%E0%A4%A')
    expect(broken.output).toBe('ok then%E0%A4%A')
    expect(broken.notes).toEqual(['Some % codes stay as typed because they form incomplete or invalid UTF-8 characters.'])
    const twice = decodeUrl('a%2520b')
    expect(twice.output).toBe('a%20b')
    expect(twice.notes.join(' ')).toMatch(/encoded twice/)
    expect(encodeUrl('a b&c=é')).toBe('a%20b%26c%3D%C3%A9')
  })

  it('guesses only clear cases', () => {
    expect(sniffEncoding(`${header}.${base64url({ a: 1 })}.c2ln`)).toBe('jwt')
    expect(sniffEncoding('name=a%20b')).toBe('url')
    expect(sniffEncoding('SGVsbG8sIHdvcmxkIQ==')).toBe('base64')
    expect(sniffEncoding('hello world')).toBeNull()
    expect(sniffEncoding('deployment')).toBeNull()
  })
})

describe('HTML report', () => {
  function input(mode: CompareInput['mode'], left: string, right: string): CompareInput {
    return { mode, left, right, leftName: '<b>before.json', rightName: 'after.json', options }
  }

  it('builds a self-contained page with the changes', () => {
    const files = input('json', '{"a":1,"list":[1,2]}', '{"a":2,"list":[1,2,3],"new":"<x>"}')
    const html = buildHtmlReport(files, compare(files.mode, files.left, files.right, files.leftName, files.rightName, files.options), new Date(now()))
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('&#60;b&#62;before.json')
    expect(html).toContain('Changed fields')
    expect(html).toContain('Line by line')
    expect(html).toContain('&#34;&#60;x&#62;&#34;')
    expect(html).not.toMatch(/<script|<link|src=/i)
  })

  it('leaves out the line section when nothing changed', () => {
    const files = input('text', 'same\n', 'same\n')
    const html = buildHtmlReport(files, compare(files.mode, files.left, files.right, files.leftName, files.rightName, files.options))
    expect(html).toContain('Identical')
    expect(html).not.toContain('Line by line')
  })

  function now() {
    return Date.UTC(2026, 10, 13, 12, 0, 0)
  }
})
