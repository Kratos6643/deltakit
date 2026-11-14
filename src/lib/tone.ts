export type ChangeFilter = 'all' | 'added' | 'removed' | 'changed' | 'moved'

export function toneGroup(kind: string): Exclude<ChangeFilter, 'all'> {
  if (kind === 'add' || kind === 'added') return 'added'
  if (kind === 'remove' || kind === 'removed') return 'removed'
  if (kind === 'moved') return 'moved'
  return 'changed'
}

export function toneClass(kind: string): string {
  const group = toneGroup(kind)
  if (group === 'added') return 'add'
  if (group === 'removed') return 'del'
  if (group === 'moved') return 'move'
  return 'mod'
}
