export type Mode = 'text' | 'json' | 'xml' | 'yaml' | 'csv'

export type ViewId = 'split' | 'unified' | 'inline' | 'chars' | 'tree' | 'fields' | 'grid' | 'patch'

export type Delimiter = ',' | ';' | '\t' | '|'

export type CompareOptions = {
  ignoreWhitespace: boolean
  ignoreCase: boolean
  ignoreFormatting: boolean
  ignoreKeyOrder: boolean
  sortLines: boolean
  ignoreListOrder: boolean
  delimiter: Delimiter | 'auto'
  ignoreFields: string[]
  ignoreText: string[]
  matchKeys: string[]
}

export type Span = {
  text: string
  changed: boolean
}

export type DiffRow = {
  kind: 'equal' | 'add' | 'remove' | 'modify'
  left?: string
  right?: string
  leftNo?: number
  rightNo?: number
  leftSpans?: Span[]
  rightSpans?: Span[]
  fuzzy?: boolean
}

export type Hunk = {
  id: string
  rowIndex: number
  kind: 'add' | 'remove' | 'modify'
  count: number
  leftNo?: number
  rightNo?: number
  preview: string
}

export type InlinePart = {
  text: string
  kind: 'equal' | 'add' | 'remove'
}

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved' | 'type' | 'reordered'

export type StructuralChange = {
  id: string
  nodeId: string
  path: string
  kind: ChangeKind
  left?: string
  right?: string
  note?: string
}

export type TreeStatus = 'same' | 'added' | 'removed' | 'changed' | 'mixed' | 'moved'

// path is what people read; id stays unique even when a removed and an added list item
// share an index, so it keys the DOM and React.
export type TreeNode = {
  id: string
  key: string
  path: string
  status: TreeStatus
  note?: string
  typeChange?: boolean
  reordered?: boolean
  leftPreview?: string
  rightPreview?: string
  children: TreeNode[]
}

export type FieldRow = {
  id: string
  path: string
  status: TreeStatus
  left?: string
  right?: string
  note?: string
  typeChange?: boolean
  reordered?: boolean
}

export type GridColumn = {
  name: string
  status: 'same' | 'added' | 'removed'
}

export type GridCell = {
  status: 'same' | 'changed' | 'added' | 'removed' | 'missing'
  text: string
  before?: string
  typeLabel?: string
}

export type GridRow = {
  id: string
  status: 'same' | 'added' | 'removed' | 'changed' | 'moved'
  label: string
  note?: string
  cells: GridCell[]
}

export type GridModel = {
  path: string
  columns: GridColumn[]
  rows: GridRow[]
  key?: string
}

export type CompareStats = {
  addedLines: number
  removedLines: number
  modifiedLines: number
  unchangedLines: number
  similarity: number
  textMatch: number | null
  fieldMatch: number | null
  addedChars: number | null
  removedChars: number | null
  moved: number
  addedFields: number
  removedFields: number
  changedFields: number
}

export type CompareResult = {
  rows: DiffRow[]
  hunks: Hunk[]
  inline: InlinePart[] | null
  chars: InlinePart[] | null
  tree: TreeNode | null
  changes: StructuralChange[]
  fields: FieldRow[]
  grid: GridModel | null
  patch: string
  leftError?: string
  rightError?: string
  notices: string[]
  info: string[]
  delimiters?: { left?: Delimiter; right?: Delimiter }
  keyChoices: string[]
  approximate: boolean
  inlineNote?: string
  charsNote?: string
  stats: CompareStats
}

export type CompareInput = {
  mode: Mode
  left: string
  right: string
  leftName: string
  rightName: string
  options: CompareOptions
}
