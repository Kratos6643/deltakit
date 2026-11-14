export type ListId = 'A' | 'B' | 'C'

export type Separator = 'auto' | 'lines' | 'commas'

export type ListOptions = {
  ignoreCase: boolean
  separator: Separator
  sort: boolean
}

export type ListFacts = {
  id: ListId
  total: number
  unique: number
  duplicates: string[]
}

export type SetGroup = 'union' | 'intersection' | 'only' | 'difference'

export type SetOperation = {
  id: string
  group: SetGroup
  label: string
  description: string
  items: string[]
}

export type ListComparison = {
  lists: ListFacts[]
  operations: SetOperation[]
}

export const LIST_IDS: ListId[] = ['A', 'B', 'C']

export const GROUP_LABELS: Record<SetGroup, string> = {
  union: 'Union',
  intersection: 'Intersection',
  only: 'Only in one list',
  difference: 'Difference',
}

// Auto reads one item per line, unless the whole list sits on one line with commas in it.
export function splitItems(text: string, separator: Separator): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const filled = lines.filter((line) => line.trim() !== '')
  const byComma = separator === 'commas' || (separator === 'auto' && filled.length === 1 && filled[0].includes(','))
  const parts = byComma ? lines.flatMap((line) => line.split(',')) : lines
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

function bit(index: number): number {
  return 1 << index
}

function names(ids: ListId[]): string {
  if (ids.length <= 2) return ids.join(' and ')
  return `${ids.slice(0, -1).join(', ')}, and ${ids[ids.length - 1]}`
}

function subsets(count: number, size: number): number[][] {
  const out: number[][] = []
  const walk = (start: number, picked: number[]) => {
    if (picked.length === size) {
      out.push(picked)
      return
    }
    for (let index = start; index < count; index += 1) walk(index + 1, [...picked, index])
  }
  walk(0, [])
  return out
}

// Each distinct item carries a mask of the lists that hold it, so every operation is a test on
// that mask. Items keep the spelling and the order in which they first appear, from A to C.
export function compareLists(texts: string[], options: ListOptions): ListComparison {
  const ids = LIST_IDS.slice(0, texts.length)
  const key = (item: string) => (options.ignoreCase ? item.toLowerCase() : item)
  const masks = new Map<string, number>()
  const shown = new Map<string, string>()

  const lists = texts.map((text, index): ListFacts => {
    const items = splitItems(text, options.separator)
    const seen = new Set<string>()
    const repeated = new Map<string, string>()
    for (const item of items) {
      const id = key(item)
      if (seen.has(id)) repeated.set(id, shown.get(id) ?? item)
      seen.add(id)
      if (!shown.has(id)) shown.set(id, item)
      masks.set(id, (masks.get(id) ?? 0) | bit(index))
    }
    return { id: ids[index], total: items.length, unique: seen.size, duplicates: [...repeated.values()] }
  })

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  const pick = (test: (mask: number) => boolean): string[] => {
    const items: string[] = []
    for (const [id, mask] of masks) if (test(mask)) items.push(shown.get(id) ?? id)
    return options.sort ? items.sort(collator.compare) : items
  }
  const maskOf = (indexes: number[]) => indexes.reduce((mask, index) => mask | bit(index), 0)
  const label = (indexes: number[], sign: string) => indexes.map((index) => ids[index]).join(` ${sign} `)
  const listed = (indexes: number[]) => names(indexes.map((index) => ids[index]))
  const slug = (indexes: number[]) => indexes.map((index) => ids[index]).join('')

  const operations: SetOperation[] = []
  const sizes = ids.length === 3 ? [3, 2] : [2]

  for (const size of sizes) {
    for (const indexes of subsets(ids.length, size)) {
      const mask = maskOf(indexes)
      operations.push({
        id: `union-${slug(indexes)}`,
        group: 'union',
        label: label(indexes, '∪'),
        description: `Everything in ${listed(indexes).replace(/and (\w)$/, 'or $1')}, each item once`,
        items: pick((item) => (item & mask) !== 0),
      })
    }
  }
  for (const size of sizes) {
    for (const indexes of subsets(ids.length, size)) {
      const mask = maskOf(indexes)
      operations.push({
        id: `intersection-${slug(indexes)}`,
        group: 'intersection',
        label: label(indexes, '∩'),
        description: size === 2 ? `Items in both ${listed(indexes)}` : `Items in all of ${listed(indexes)}`,
        items: pick((item) => (item & mask) === mask),
      })
    }
  }
  ids.forEach((id, index) => {
    const others = ids.filter((other) => other !== id)
    operations.push({
      id: `only-${id}`,
      group: 'only',
      label: `Only ${id}`,
      description: `Items in ${id} and not in ${others.join(' or ')}`,
      items: pick((item) => item === bit(index)),
    })
  })
  operations.push({
    id: 'only-one',
    group: 'only',
    label: ids.length === 2 ? 'A △ B' : 'In exactly one',
    description: ids.length === 2 ? 'Items in A or B, but not in both' : 'Items that appear in just one of the three lists',
    items: pick((item) => (item & (item - 1)) === 0),
  })
  if (ids.length === 3) {
    ids.forEach((id, index) => {
      ids.forEach((other, otherIndex) => {
        if (index === otherIndex) return
        operations.push({
          id: `difference-${id}${other}`,
          group: 'difference',
          label: `${id} − ${other}`,
          description: `Items in ${id} that are not in ${other}`,
          items: pick((item) => (item & bit(index)) !== 0 && (item & bit(otherIndex)) === 0),
        })
      })
    })
  }

  return { lists, operations }
}
