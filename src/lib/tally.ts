import type { CompareResult, ViewId } from '../types.ts'

export type Verdict = {
  percent: number
  identical: boolean
}

export type Tally = {
  unit: 'Lines' | 'Fields' | 'Rows'
  added: number
  removed: number
  changed: number
  moved: number
}

export function verdictFor(result: CompareResult): Verdict {
  const gridSame = !result.grid || result.grid.rows.every((row) => row.status === 'same')
  const identical = result.hunks.length === 0 && result.changes.length === 0 && gridSame
  return { percent: identical ? 100 : result.stats.textMatch ?? result.stats.similarity, identical }
}

export function tallyFor(view: ViewId, result: CompareResult): Tally {
  const { stats } = result
  if ((view === 'tree' || view === 'fields') && stats.fieldMatch !== null) {
    return {
      unit: 'Fields',
      added: stats.addedFields,
      removed: stats.removedFields,
      changed: result.changes.filter((change) => change.kind === 'changed' || change.kind === 'type' || change.kind === 'reordered').length,
      moved: stats.moved,
    }
  }
  if (view === 'grid' && result.grid) {
    const counts = { added: 0, removed: 0, changed: 0, moved: 0, same: 0 }
    for (const row of result.grid.rows) counts[row.status] += 1
    return { unit: 'Rows', added: counts.added, removed: counts.removed, changed: counts.changed, moved: counts.moved }
  }
  return { unit: 'Lines', added: stats.addedLines, removed: stats.removedLines, changed: stats.modifiedLines, moved: 0 }
}

export function headlineFor(verdict: Verdict): string {
  if (verdict.identical) return 'Identical'
  if (verdict.percent >= 90) return 'Nearly identical'
  if (verdict.percent >= 60) return 'Similar'
  if (verdict.percent >= 30) return 'Quite different'
  return 'Very different'
}
