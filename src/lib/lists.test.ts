import { describe, expect, it } from 'vitest'
import { compareLists, splitItems, type ListOptions } from './lists.ts'

const base: ListOptions = { ignoreCase: false, separator: 'auto', sort: false }

function results(texts: string[], options: ListOptions = base): Record<string, string[]> {
  return Object.fromEntries(compareLists(texts, options).operations.map((operation) => [operation.label, operation.items]))
}

describe('lists', () => {
  it('splits by line, or by comma when the list is one line', () => {
    expect(splitItems(' a \r\n\nb, c\n', 'auto')).toEqual(['a', 'b, c'])
    expect(splitItems('a, b ,,c', 'auto')).toEqual(['a', 'b', 'c'])
    expect(splitItems('a, b\nc', 'commas')).toEqual(['a', 'b', 'c'])
    expect(splitItems('a, b', 'lines')).toEqual(['a, b'])
  })

  it('compares two lists', () => {
    const sets = results(['a\nb\nc', 'b\nc\nd'])
    expect(sets['A ∪ B']).toEqual(['a', 'b', 'c', 'd'])
    expect(sets['A ∩ B']).toEqual(['b', 'c'])
    expect(sets['Only A']).toEqual(['a'])
    expect(sets['Only B']).toEqual(['d'])
    expect(sets['A △ B']).toEqual(['a', 'd'])
    expect(Object.keys(sets)).toHaveLength(5)
  })

  it('compares three lists in every combination', () => {
    const sets = results(['1\n2\n3\n4', '3\n4\n5\n6', '4\n6\n7\n1'])
    expect(sets['A ∪ B ∪ C']).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(sets['A ∪ C']).toEqual(['1', '2', '3', '4', '6', '7'])
    expect(sets['A ∩ B ∩ C']).toEqual(['4'])
    expect(sets['A ∩ B']).toEqual(['3', '4'])
    expect(sets['B ∩ C']).toEqual(['4', '6'])
    expect(sets['Only A']).toEqual(['2'])
    expect(sets['Only B']).toEqual(['5'])
    expect(sets['Only C']).toEqual(['7'])
    expect(sets['In exactly one']).toEqual(['2', '5', '7'])
    expect(sets['A − B']).toEqual(['1', '2'])
    expect(sets['B − A']).toEqual(['5', '6'])
    expect(sets['C − B']).toEqual(['1', '7'])
    expect(Object.keys(sets)).toHaveLength(18)
  })

  it('counts duplicates and follows the options', () => {
    const comparison = compareLists(['b\nApple\napple\nb\nb', 'APPLE\nc10\nc9'], { ignoreCase: true, separator: 'auto', sort: true })
    expect(comparison.lists[0]).toEqual({ id: 'A', total: 5, unique: 2, duplicates: ['Apple', 'b'] })
    const sets = Object.fromEntries(comparison.operations.map((operation) => [operation.label, operation.items]))
    expect(sets['A ∩ B']).toEqual(['Apple'])
    expect(sets['A ∪ B']).toEqual(['Apple', 'b', 'c9', 'c10'])
    expect(results(['Apple', 'apple'])['A ∩ B']).toEqual([])
  })
})
