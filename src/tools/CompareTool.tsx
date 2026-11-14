import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ChangesPanel, type ChangeItem } from '../components/ChangesPanel.tsx'
import { DiffCanvas } from '../components/DiffCanvas.tsx'
import { DraftInput } from '../components/DraftInput.tsx'
import { EditorPane } from '../components/EditorPane.tsx'
import {
  BeautifyIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CollapseIcon,
  CompareIcon,
  CopyIcon,
  DeleteIcon,
  DownloadIcon,
  ExpandIcon,
  ExportIcon,
  ListIcon,
  ReportIcon,
  SlidersIcon,
  SwapIcon,
  WrapIcon,
} from '../components/Icons.tsx'
import { Popover } from '../components/Popover.tsx'
import { Segmented, type SegmentOption } from '../components/Segmented.tsx'
import { SplitBox } from '../components/SplitBox.tsx'
import { Summary } from '../components/Summary.tsx'
import { Switch } from '../components/Switch.tsx'
import { copyAndTell, downloadText } from '../lib/clipboard.ts'
import { buildReport } from '../lib/compare.ts'
import { DELIMITERS } from '../lib/csv.ts'
import { formatSource, type FormatOp } from '../lib/format.ts'
import { patternError, splitList, TEXT_PRESETS, type TextPreset } from '../lib/ignore.ts'
import { isTyping, MOD_KEY } from '../lib/keys.ts'
import { defaultName, MODE_META } from '../lib/modes.ts'
import { buildHtmlReport } from '../lib/report.ts'
import type { Handoff } from '../lib/routes.ts'
import { tallyFor, verdictFor } from '../lib/tally.ts'
import { toneGroup, type ChangeFilter } from '../lib/tone.ts'
import { useComparison } from '../lib/useComparison.ts'
import { errorMessage, jsonError } from '../lib/values.ts'
import type { CompareInput, CompareOptions, CompareResult, Delimiter, Hunk, Mode, ViewId } from '../types.ts'

type GroupId = 'split' | 'unified' | 'words' | 'structure' | 'grid' | 'patch'
type WordView = 'inline' | 'chars'
type StructureView = 'tree' | 'fields'
type Files = Omit<CompareInput, 'options'>
type SeparatorId = 'auto' | 'comma' | 'semicolon' | 'tab' | 'pipe'

const GROUPS: { id: GroupId; label: string; title: string }[] = [
  { id: 'split', label: 'Side by side', title: 'Both versions next to each other' },
  { id: 'unified', label: 'Inline', title: 'One column, removed lines above added lines' },
  { id: 'words', label: 'Track changes', title: 'Reads like an edited document' },
  { id: 'structure', label: 'Structure', title: 'Compare the data itself, matched by key' },
  { id: 'grid', label: 'Table', title: 'Rows and cells, matched by id or name' },
  { id: 'patch', label: 'Patch', title: 'A unified diff to copy or download' },
]

// Free-text settings stay as typed; they become lists only when the comparison runs.
type Settings = {
  ignoreWhitespace: boolean
  ignoreCase: boolean
  ignoreFormatting: boolean
  ignoreKeyOrder: boolean
  sortLines: boolean
  ignoreListOrder: boolean
  delimiter: Delimiter | 'auto'
  ignoreFields: string
  presets: TextPreset[]
  ignorePattern: string
  matchKeys: string
}

const DEFAULTS: Settings = {
  ignoreWhitespace: true,
  ignoreCase: false,
  ignoreFormatting: true,
  ignoreKeyOrder: true,
  sortLines: false,
  ignoreListOrder: false,
  delimiter: 'auto',
  ignoreFields: '',
  presets: [],
  ignorePattern: '',
  matchKeys: '',
}

const SEPARATOR_IDS: Record<Delimiter, Exclude<SeparatorId, 'auto'>> = { ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }

const SEPARATORS: SegmentOption<SeparatorId>[] = [
  { id: 'auto', label: 'Auto', title: 'Find the separator in each file' },
  ...DELIMITERS.map((item) => ({ id: SEPARATOR_IDS[item.id], label: item.label, title: `Read both files as separated by ${item.name}` })),
]

// Each mode only sees the settings that apply to it, so switching modes never changes
// a result through a setting that is hidden.
function optionsFor(mode: Mode, settings: Settings): CompareOptions {
  const text = mode === 'text'
  const patterns: string[] = TEXT_PRESETS.filter((preset) => settings.presets.includes(preset.id)).map((preset) => preset.pattern)
  if (settings.ignorePattern !== '' && patternError(settings.ignorePattern) === null) patterns.push(settings.ignorePattern)
  return {
    ignoreWhitespace: settings.ignoreWhitespace,
    ignoreCase: text && settings.ignoreCase,
    ignoreFormatting: text ? DEFAULTS.ignoreFormatting : settings.ignoreFormatting,
    ignoreKeyOrder: mode === 'json' || mode === 'yaml' ? settings.ignoreKeyOrder : DEFAULTS.ignoreKeyOrder,
    sortLines: text && settings.sortLines,
    ignoreListOrder: !text && settings.ignoreListOrder,
    delimiter: mode === 'csv' ? settings.delimiter : 'auto',
    ignoreFields: text ? [] : splitList(settings.ignoreFields),
    ignoreText: text ? patterns : [],
    matchKeys: text ? [] : splitList(settings.matchKeys),
  }
}

const NARROW = '(max-width: 760px)'

function narrow(): boolean {
  return window.matchMedia?.(NARROW).matches ?? false
}

function watchNarrow(onChange: () => void): () => void {
  const query = window.matchMedia?.(NARROW)
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

function groupOf(view: ViewId): GroupId {
  if (view === 'inline' || view === 'chars') return 'words'
  if (view === 'tree' || view === 'fields') return 'structure'
  return view
}

function isEnabled(view: ViewId, mode: Mode, result: CompareResult): boolean {
  if (view === 'tree' || view === 'fields') return mode !== 'text' && result.tree !== null
  if (view === 'grid') return result.grid !== null && result.grid.columns.length > 0
  return true
}

function disabledReason(group: GroupId): string {
  if (group === 'structure') return 'Both sides need to be valid data to compare their structure'
  if (group === 'grid') return 'Table appears for CSV and for lists of objects'
  return ''
}

function formatOps(mode: Mode): { op: FormatOp; label: string; title: string }[] {
  if (mode === 'text') return [{ op: 'tidy', label: 'Tidy', title: 'Remove trailing spaces on both sides' }]
  if (mode === 'csv') return [{ op: 'pretty', label: 'Normalize', title: 'Rewrite both sides with consistent quoting' }]
  const beautify = { op: 'pretty' as const, label: 'Beautify', title: 'Indent both sides neatly' }
  const minify = { op: 'minify' as const, label: 'Minify', title: 'Compact both sides onto as few lines as possible' }
  const sort = { op: 'sort' as const, label: 'Sort keys', title: 'Order object keys alphabetically on both sides' }
  if (mode === 'yaml') return [beautify, sort]
  if (mode === 'xml') return [beautify, minify]
  return [beautify, minify, sort]
}

function sniffMode(name: string, text: string): Mode | null {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'json') return 'json'
  if (ext === 'xml') return 'xml'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  if (ext === 'txt' || ext === 'md' || ext === 'log' || ext === 'diff' || ext === 'patch') return 'text'
  const trimmed = text.trim()
  if (trimmed.startsWith('<')) return 'xml'
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  return null
}

function failure(mode: Mode, text: string, error: unknown): string {
  if (mode === 'json') return jsonError(text, error)
  if (mode === 'xml') return `Invalid XML — ${errorMessage(error)}`
  if (mode === 'yaml') return `Invalid YAML — ${errorMessage(error)}`
  return errorMessage(error)
}

function separatorsFound(delimiters: CompareResult['delimiters']): string | undefined {
  const name = (id?: Delimiter) => DELIMITERS.find((item) => item.id === id)?.name
  const left = name(delimiters?.left)
  const right = name(delimiters?.right)
  if (left && right && left !== right) return `Before uses ${left} and After uses ${right}.`
  const found = left ?? right
  return found ? `Found ${found}.` : undefined
}

function buildItems(view: ViewId, result: CompareResult): ChangeItem[] {
  if (view === 'tree') {
    return result.changes.map((change) => ({
      id: change.id,
      domId: `node-${encodeURIComponent(change.nodeId || 'root')}`,
      kind: change.kind,
      title: change.path,
      detail: change.note ?? [change.left, change.right].filter((value) => value).join(' → '),
    }))
  }
  if (view === 'fields') {
    return result.fields.filter((field) => field.status !== 'same' || field.reordered).map((field) => ({
      id: field.id,
      domId: `field-${encodeURIComponent(field.id)}`,
      kind: field.typeChange ? 'type' : field.reordered ? 'reordered' : field.status,
      title: field.path,
      detail: field.note ?? [field.left, field.right].filter((value) => value).join(' → '),
    }))
  }
  if (view === 'grid' && result.grid) {
    return result.grid.rows.filter((row) => row.status !== 'same').map((row) => ({
      id: row.id,
      domId: `grid-${encodeURIComponent(row.id)}`,
      kind: row.status,
      title: row.label,
      detail: row.note ?? row.cells.filter((cell) => cell.status !== 'same' && cell.status !== 'missing').map((cell) => cell.before ? `${cell.before} → ${cell.text}` : cell.text).slice(0, 3).join(' · '),
    }))
  }
  return result.hunks.map((hunk) => ({
    id: hunk.id,
    domId: `diff-row-${hunk.rowIndex}`,
    kind: hunk.kind,
    title: hunk.preview,
    detail: [hunkPlace(hunk), `${hunk.count} ${hunk.count === 1 ? 'line' : 'lines'}`].filter(Boolean).join(' · '),
    rowIndex: hunk.rowIndex,
  }))
}

function hunkPlace({ leftNo, rightNo }: Hunk): string {
  if (leftNo && rightNo) return leftNo === rightNo ? `Line ${leftNo}` : `Line ${leftNo} → ${rightNo}`
  if (leftNo) return `Before, line ${leftNo}`
  if (rightNo) return `After, line ${rightNo}`
  return ''
}

const Panel = memo(ChangesPanel)
const initial: Files = { mode: 'json', left: '', right: '', leftName: defaultName('before', 'json'), rightName: defaultName('after', 'json') }

type CompareToolProps = {
  active: boolean
  notify: (text: string) => void
  incoming?: Handoff
}

export function CompareTool({ active, notify, incoming }: CompareToolProps) {
  const [mode, setMode] = useState<Mode>(initial.mode)
  // Until a view is picked, lines show side by side on wide screens and inline on narrow ones,
  // and follow the window when it is resized or the phone is turned.
  const [pickedView, setView] = useState<ViewId | null>(null)
  const lineView: ViewId = useSyncExternalStore(watchNarrow, narrow) ? 'unified' : 'split'
  const view = pickedView ?? lineView
  const [wordView, setWordView] = useState<WordView>('inline')
  const [structureView, setStructureView] = useState<StructureView>('tree')
  const [left, setLeft] = useState(initial.left)
  const [right, setRight] = useState(initial.right)
  const [leftName, setLeftName] = useState(initial.leftName)
  const [rightName, setRightName] = useState(initial.rightName)
  const [compared, setCompared] = useState<Files>(initial)
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [showAll, setShowAll] = useState(false)
  const [editorsOpen, setEditorsOpen] = useState(true)
  const [wrap, setWrap] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ChangeFilter>('all')
  const [formatErrors, setFormatErrors] = useState<{ left?: string; right?: string }>({})
  const [pins, setPins] = useState<Set<number>>(() => new Set())
  const [focus, setFocus] = useState<{ id: string; scroll: boolean } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const revealRef = useRef(false)

  // Two files from the Home page are compared right away; one file becomes the Before side.
  const [taken, setTaken] = useState<number | undefined>(undefined)
  if (incoming && incoming.at !== taken) {
    setTaken(incoming.at)
    const [first, second] = incoming.files
    const nextMode = sniffMode(first.name ?? '', first.text) ?? (second ? sniffMode(second.name ?? '', second.text) : null) ?? mode
    const firstName = first.name ?? defaultName('before', nextMode)
    setMode(nextMode)
    setLeft(first.text)
    setLeftName(firstName)
    if (second) {
      const secondName = second.name ?? defaultName('after', nextMode)
      setRight(second.text)
      setRightName(secondName)
      setCompared({ mode: nextMode, left: first.text, right: second.text, leftName: firstName, rightName: secondName })
    } else if (rightName === defaultName('after', mode)) {
      setRightName(defaultName('after', nextMode))
    }
    setFormatErrors({})
    setEditorsOpen(true)
  }

  // Edits to the files wait for Compare. Options apply right away, because they
  // only change how the files that were last compared are read.
  const optionsKey = JSON.stringify(optionsFor(compared.mode, settings))
  const input = useMemo<CompareInput>(() => ({ ...compared, options: JSON.parse(optionsKey) as CompareOptions }), [compared, optionsKey])
  const { comparison, pending } = useComparison(input)
  const result = comparison.result
  const shownMode = comparison.input.mode
  const shownOptions = comparison.input.options
  const meta = MODE_META.find((item) => item.id === mode) ?? MODE_META[0]
  const blank = left.trim() === '' && right.trim() === ''
  const comparedBlank = compared.left.trim() === '' && compared.right.trim() === ''
  if (blank && !comparedBlank) setCompared({ mode, left, right, leftName, rightName })
  const outdated = !blank && (
    compared.mode !== mode || compared.left !== left || compared.right !== right
    || compared.leftName !== leftName || compared.rightName !== rightName
  )
  const waiting = !blank && comparedBlank
  const stale = outdated && !comparedBlank

  const [seen, setSeen] = useState(result)
  if (seen !== result) {
    setSeen(result)
    setPins(new Set())
    setFocus(null)
  }
  const focusDomId = focus?.id ?? null
  const activeView = isEnabled(view, shownMode, result) ? view : lineView
  const activeGroup = groupOf(activeView)

  useEffect(() => {
    if (!focus?.scroll) return
    document.getElementById(focus.id)?.scrollIntoView({ block: 'center', behavior: scrollBehavior() })
  }, [focus])

  useEffect(() => {
    if (incoming && incoming.at === taken && incoming.files.length >= 2) revealRef.current = true
  }, [incoming, taken])

  // The page grows to fit a new result only once it arrives, so the scroll waits for it.
  useEffect(() => {
    if (!revealRef.current || pending || !active) return
    revealRef.current = false
    const results = resultsRef.current
    if (results && results.getBoundingClientRect().top > window.innerHeight * 0.7) {
      results.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
    }
  }, [pending, result, active])

  const items = useMemo(() => buildItems(activeView, result), [activeView, result])
  const counts = useMemo<Record<ChangeFilter, number>>(() => {
    const next = { all: items.length, added: 0, removed: 0, changed: 0, moved: 0 }
    for (const item of items) next[toneGroup(item.kind)] += 1
    return next
  }, [items])
  const activeFilter = filter !== 'all' && counts[filter] === 0 ? 'all' : filter
  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (activeFilter !== 'all' && toneGroup(item.kind) !== activeFilter) return false
      if (!q) return true
      return `${item.title}\n${item.detail}`.toLowerCase().includes(q)
    })
  }, [items, activeFilter, query])
  const position = visibleItems.findIndex((item) => item.domId === focusDomId) + 1
  const tally = useMemo(() => tallyFor(activeView, result), [activeView, result])
  const verdict = useMemo(() => verdictFor(result), [result])

  const closeList = useCallback(() => {
    setListOpen(false)
    setQuery('')
    setFilter('all')
  }, [])

  const choose = useCallback((item: ChangeItem) => {
    if ((activeView === 'inline' || activeView === 'chars' || activeView === 'patch') && item.rowIndex !== undefined) {
      setView(null)
    }
    if (item.rowIndex !== undefined) {
      const rowIndex = item.rowIndex
      setPins((current) => (current.has(rowIndex) ? current : new Set(current).add(rowIndex)))
    }
    setFocus({ id: item.domId, scroll: true })
    if (narrow()) closeList()
  }, [activeView, closeList])

  const expand = useCallback((start: number, count: number) => {
    setPins((current) => {
      const next = new Set(current)
      for (let index = start; index < start + count; index += 1) next.add(index)
      return next
    })
  }, [])
  const selectRow = useCallback((index: number) => setFocus({ id: `diff-row-${index}`, scroll: false }), [])
  const showEverything = useCallback(() => setShowAll(true), [])

  function compareNow() {
    if (blank) return
    if (!outdated) {
      if (!pending) notify('The result is already up to date')
      return
    }
    setCompared({ mode, left, right, leftName, rightName })
    revealRef.current = true
  }

  function move(direction: 1 | -1) {
    if (visibleItems.length === 0) return
    const current = visibleItems.findIndex((item) => item.domId === focusDomId)
    const nextIndex = current === -1
      ? (direction === 1 ? 0 : visibleItems.length - 1)
      : (current + direction + visibleItems.length) % visibleItems.length
    choose(visibleItems[nextIndex])
  }

  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        compareNow()
        return
      }
      if (event.key === 'Escape') {
        if (listOpen) closeList()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      if (event.key === '/') {
        event.preventDefault()
        setListOpen(true)
        window.setTimeout(() => searchRef.current?.focus(), 0)
      } else if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        move(event.key === 'j' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function switchMode(next: Mode) {
    if (leftName === defaultName('before', mode)) setLeftName(defaultName('before', next))
    if (rightName === defaultName('after', mode)) setRightName(defaultName('after', next))
    setMode(next)
  }

  function selectMode(next: Mode) {
    if (next === mode) return
    switchMode(next)
    setFormatErrors({})
    setQuery('')
  }

  function selectGroup(group: GroupId) {
    if (group === 'words') setView(wordView)
    else if (group === 'structure') setView(structureView)
    else setView(group)
  }

  function applyFormat(op: FormatOp, label: string) {
    const next: { left?: string; right?: string } = {}
    try {
      setLeft(formatSource(mode, left, op))
    } catch (error) {
      next.left = failure(mode, left, error)
    }
    try {
      setRight(formatSource(mode, right, op))
    } catch (error) {
      next.right = failure(mode, right, error)
    }
    setFormatErrors(next)
    if (!next.left && !next.right) notify(`${label} applied to both sides`)
  }

  function onFile(side: 'left' | 'right', name: string, text: string) {
    const sniffed = sniffMode(name, text)
    const otherEmpty = side === 'left' ? right.trim() === '' : left.trim() === ''
    if (sniffed && otherEmpty && sniffed !== mode) switchMode(sniffed)
    if (side === 'left') {
      setLeft(text)
      setLeftName(name)
      setFormatErrors((current) => ({ ...current, left: undefined }))
    } else {
      setRight(text)
      setRightName(name)
      setFormatErrors((current) => ({ ...current, right: undefined }))
    }
  }

  function swap() {
    setLeft(right)
    setRight(left)
    setLeftName(rightName)
    setRightName(leftName)
    setFormatErrors({ left: formatErrors.right, right: formatErrors.left })
  }

  function clearBoth() {
    setLeft('')
    setRight('')
    setLeftName(defaultName('before', mode))
    setRightName(defaultName('after', mode))
    setFormatErrors({})
  }

  function copy(text: string, label: string) {
    copyAndTell(text, label, notify)
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function togglePreset(id: TextPreset) {
    setSettings((current) => ({
      ...current,
      presets: current.presets.includes(id) ? current.presets.filter((item) => item !== id) : [...current.presets, id],
    }))
  }

  function downloadReport() {
    downloadText('deltakit-report.html', buildHtmlReport(comparison.input, result), 'text/html;charset=utf-8')
    notify('Saved deltakit-report.html')
  }

  const structured = mode !== 'text'
  const keyed = mode === 'json' || mode === 'yaml'
  const csv = mode === 'csv'
  const optionsChanged = JSON.stringify(optionsFor(mode, settings)) !== JSON.stringify(optionsFor(mode, DEFAULTS))
  const separator: SeparatorId = settings.delimiter === 'auto' ? 'auto' : SEPARATOR_IDS[settings.delimiter]
  const found = settings.delimiter === 'auto' && shownMode === 'csv' ? separatorsFound(result.delimiters) : undefined
  const foldable = activeView !== 'inline' && activeView !== 'chars' && activeView !== 'patch'
  const changedRows = result.grid ? result.grid.rows.filter((row) => row.status !== 'same').length : 0
  const groupOptions: SegmentOption<GroupId>[] = GROUPS
    .filter((group) => shownMode !== 'text' || (group.id !== 'structure' && group.id !== 'grid'))
    .map((group) => {
      const enabled = group.id === 'structure' ? isEnabled('tree', shownMode, result) : group.id === 'grid' ? isEnabled('grid', shownMode, result) : true
      return {
        id: group.id,
        label: group.label,
        title: enabled ? group.title : disabledReason(group.id),
        disabled: !enabled,
        badge: group.id === 'structure' && enabled ? result.changes.length : group.id === 'grid' && enabled ? changedRows : undefined,
      }
    })
  const listTitle = activeView === 'tree' || activeView === 'fields' ? 'Changed fields' : activeView === 'grid' ? 'Changed rows' : 'Changed lines'
  const navLabel = visibleItems.length === 0
    ? 'No changes'
    : position > 0
      ? `${position} of ${visibleItems.length.toLocaleString()}`
      : `${visibleItems.length.toLocaleString()} ${visibleItems.length === 1 ? 'change' : 'changes'}`

  return (
    <div className="page" hidden={!active} data-testid="page-compare">
      <header className="page-head">
        <div className="page-title">
          <p className="eyebrow">Compare</p>
          <h1>Compare two files</h1>
          <p className="page-lead">Paste or drop the older version on the left and the newer one on the right, then press Compare.</p>
        </div>
        <div className="page-controls">
          <Segmented
            label="File type"
            testId="mode"
            options={MODE_META.map((item) => ({ id: item.id, label: item.label, title: item.blurb }))}
            value={mode}
            onChange={selectMode}
          />
        </div>
      </header>

      <div className="inputs">
        {editorsOpen ? (
          <SplitBox
            label="Files to compare"
            toolbar={
              <>
                <div className="tb-group">
                  <span className="tb-chip" data-testid="mode-chip">{meta.label}</span>
                  <span className="tb-chip is-plain">UTF-8</span>
                </div>
                <div className="tb-group">
                  {formatOps(mode).map((item, index) => (
                    <button key={item.op} type="button" className="tb-btn" title={item.title} disabled={blank} onClick={() => applyFormat(item.op, item.label)}>
                      {index === 0 ? <BeautifyIcon size={14} /> : null}
                      {item.label}
                    </button>
                  ))}
                  <button type="button" className="tb-btn" aria-pressed={wrap} title="Fold long lines to fit the pane" data-testid="wrap" onClick={() => setWrap((on) => !on)}>
                    <WrapIcon size={14} />
                    Soft wrap
                  </button>
                  <button type="button" className="tb-btn" title="Swap the Before and After sides" aria-label="Swap sides" data-testid="swap" disabled={blank} onClick={swap}>
                    <SwapIcon size={14} />
                    Swap
                  </button>
                  <button type="button" className="tb-btn is-danger" title="Clear both sides" data-testid="clear-both" disabled={blank} onClick={clearBoth}>
                    <DeleteIcon size={14} />
                    Clear
                  </button>
                </div>
              </>
            }
            left={
              <EditorPane
                side="before"
                name={leftName}
                text={left}
                mode={mode}
                modeLabel={meta.label}
                wrap={wrap}
                error={formatErrors.left ?? (shownMode === mode && comparison.input.left === left ? result.leftError : undefined)}
                onText={(text) => {
                  setLeft(text)
                  setFormatErrors((current) => (current.left ? { ...current, left: undefined } : current))
                }}
                onFile={(name, text) => onFile('left', name, text)}
                onClear={() => {
                  setLeft('')
                  setLeftName(defaultName('before', mode))
                }}
                onCopy={() => copy(left, 'Before text')}
              />
            }
            right={
              <EditorPane
                side="after"
                name={rightName}
                text={right}
                mode={mode}
                modeLabel={meta.label}
                wrap={wrap}
                error={formatErrors.right ?? (shownMode === mode && comparison.input.right === right ? result.rightError : undefined)}
                onText={(text) => {
                  setRight(text)
                  setFormatErrors((current) => (current.right ? { ...current, right: undefined } : current))
                }}
                onFile={(name, text) => onFile('right', name, text)}
                onClear={() => {
                  setRight('')
                  setRightName(defaultName('after', mode))
                }}
                onCopy={() => copy(right, 'After text')}
              />
            }
            status={<span>Type <b>{meta.label}</b></span>}
          />
        ) : (
          <div className="files-bar">
            <span className="file-chip"><span className="side-dot before" aria-hidden="true" /><span className="file-name">{leftName}</span><span className="side-label">(Before)</span></span>
            <button type="button" className="tb-btn" onClick={swap} aria-label="Swap sides" title="Swap the Before and After sides">
              <SwapIcon size={14} />
              Swap
            </button>
            <span className="file-chip"><span className="side-dot after" aria-hidden="true" /><span className="file-name">{rightName}</span><span className="side-label">(After)</span></span>
          </div>
        )}
        <div className="bridge">
          <div className="bridge-side is-start" />
          <button
            type="button"
            className={`btn primary compare${outdated ? ' is-due' : ''}`}
            data-testid="compare"
            disabled={blank}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            title={blank ? 'Add text on either side first' : `Compare the two sides · ${MOD_KEY} Enter`}
            onClick={compareNow}
          >
            {pending ? 'Comparing…' : 'Compare'}
            <kbd aria-hidden="true">{MOD_KEY} ↵</kbd>
          </button>
          <div className="bridge-side is-end">
            <button type="button" className="btn ghost" aria-expanded={editorsOpen} onClick={() => setEditorsOpen((open) => !open)}>
              {editorsOpen ? <CollapseIcon size={15} /> : <ExpandIcon size={15} />}
              {editorsOpen ? 'Hide files' : 'Show files'}
            </button>
          </div>
        </div>
      </div>

      <section ref={resultsRef} className={`results${stale ? ' is-stale' : ''}${listOpen ? ' has-panel' : ''}`} aria-label="Comparison">
        <div className="results-head">
          <Summary
            verdict={verdict}
            tally={tally}
            hint={blank ? 'Add a file on each side' : waiting ? 'Press Compare to see the differences' : undefined}
          />
          <Segmented label="View" testId="view" options={groupOptions} value={activeGroup} onChange={selectGroup} />
          <div className="results-tools">
            <Switch
              label="Show unchanged"
              checked={showAll}
              onChange={setShowAll}
              disabled={!foldable}
              title={foldable ? 'Show the lines, fields, or rows that match too' : 'Track changes and Patch always show the whole result'}
              testId="show-all"
            />
            <Popover label="Options" icon={<SlidersIcon />} marked={optionsChanged} title="Choose what counts as a change" testId="options">
              {() => (
                <div className="menu">
                  <p className="menu-title">What counts as a change</p>
                  <Switch
                    label="Ignore spaces at line ends"
                    description="Leading and trailing spaces are skipped"
                    checked={settings.ignoreWhitespace}
                    onChange={(value) => set('ignoreWhitespace', value)}
                    testId="opt-trim"
                  />
                  {structured ? (
                    <>
                      <Switch
                        label="Compare the data only"
                        description="Indentation, spacing, and quoting are skipped"
                        checked={settings.ignoreFormatting}
                        onChange={(value) => set('ignoreFormatting', value)}
                        testId="opt-format"
                      />
                      {keyed ? (
                        <Switch
                          label="Ignore key order"
                          description="Objects match in any key order"
                          checked={settings.ignoreKeyOrder}
                          onChange={(value) => set('ignoreKeyOrder', value)}
                          testId="opt-keys"
                        />
                      ) : null}
                      <Switch
                        label={csv ? 'Ignore row order' : 'Ignore list order'}
                        description={csv ? 'Rows match wherever they sit in the file' : 'List items match wherever they sit in the list'}
                        checked={settings.ignoreListOrder}
                        onChange={(value) => set('ignoreListOrder', value)}
                        testId="opt-lists"
                      />
                    </>
                  ) : (
                    <>
                      <Switch
                        label="Ignore line order"
                        description="Both sides are sorted first, so moved lines match"
                        checked={settings.sortLines}
                        onChange={(value) => set('sortLines', value)}
                        testId="opt-sort"
                      />
                      <Switch
                        label="Ignore letter case"
                        description="“Hello” and “hello” match"
                        checked={settings.ignoreCase}
                        onChange={(value) => set('ignoreCase', value)}
                        testId="opt-case"
                      />
                    </>
                  )}
                  <div className="menu-sep" role="separator" />
                  {structured ? (
                    <>
                      {csv ? (
                        <div className="field">
                          <span className="field-label">Separator</span>
                          <Segmented
                            small
                            label="Separator"
                            testId="opt-sep"
                            options={SEPARATORS}
                            value={separator}
                            onChange={(next) => set('delimiter', next === 'auto' ? 'auto' : DELIMITERS.find((item) => SEPARATOR_IDS[item.id] === next)?.id ?? 'auto')}
                          />
                          {found ? <span className="field-hint" data-testid="opt-sep-found">{found}</span> : null}
                        </div>
                      ) : null}
                      <DraftInput
                        label={csv ? 'Ignore columns' : 'Ignore fields'}
                        value={settings.ignoreFields}
                        onCommit={(value) => set('ignoreFields', value)}
                        placeholder={csv ? 'updated, notes' : 'updatedAt, meta.requestId'}
                        hint={csv ? 'Column names, separated by commas.' : 'Names or dotted paths, separated by commas. * matches any characters.'}
                        testId="opt-ignore"
                      />
                      <DraftInput
                        label={csv ? 'Match rows by' : 'Match list items by'}
                        value={settings.matchKeys}
                        onCommit={(value) => set('matchKeys', value)}
                        placeholder="Automatic"
                        hint={csv ? 'A column with a different value on every row, such as id.' : 'A field with a different value on every item, such as id or sku.'}
                        suggestions={result.keyChoices}
                        testId="opt-match"
                      />
                    </>
                  ) : (
                    <DraftInput
                      label="Ignore matching text"
                      value={settings.ignorePattern}
                      onCommit={(value) => set('ignorePattern', value)}
                      placeholder="Your own pattern, such as req-[0-9]+"
                      hint="A regular expression. Text it matches is skipped on every line."
                      validate={patternError}
                      testId="opt-pattern"
                    >
                      <div className="field-chips" role="group" aria-label="Common patterns">
                        {TEXT_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className="chip"
                            aria-pressed={settings.presets.includes(preset.id)}
                            data-testid={`opt-preset-${preset.id}`}
                            onClick={() => togglePreset(preset.id)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </DraftInput>
                  )}
                  <button type="button" className="btn ghost menu-reset" disabled={!optionsChanged} onClick={() => setSettings(DEFAULTS)}>Reset to defaults</button>
                </div>
              )}
            </Popover>
            <Popover label="Export" icon={<ExportIcon />} title="Share, copy, or download the result" testId="export">
              {(close) => (
                <div className="menu">
                  <button
                    type="button"
                    className="menu-item"
                    disabled={blank || waiting}
                    data-testid="export-report"
                    onClick={() => {
                      downloadReport()
                      close()
                    }}
                  >
                    <ReportIcon />
                    <span><b>Download report</b><small>A web page to share, open anywhere, or print</small></span>
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    disabled={!result.patch}
                    onClick={() => {
                      copy(result.patch, 'Patch')
                      close()
                    }}
                  >
                    <CopyIcon />
                    <span><b>Copy patch</b><small>Unified diff for git or patch</small></span>
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    disabled={!result.patch}
                    onClick={() => {
                      downloadText('deltakit.diff', result.patch)
                      notify('Saved deltakit.diff')
                      close()
                    }}
                  >
                    <DownloadIcon />
                    <span><b>Download patch</b><small>Saves deltakit.diff</small></span>
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      copy(buildReport(result, comparison.input.leftName, comparison.input.rightName), 'Summary')
                      close()
                    }}
                  >
                    <CopyIcon />
                    <span><b>Copy summary</b><small>A short text report of the changes</small></span>
                  </button>
                </div>
              )}
            </Popover>
          </div>
        </div>

        <div className={`canvas${pending ? ' is-pending' : ''}${stale ? ' is-stale' : ''}${listOpen ? ' has-panel' : ''}`} data-testid="canvas">
          {stale ? (
            <div className="stale-bar" data-testid="stale">
              <span>This result is from before your latest edits.</span>
              <button type="button" className="btn primary small" onClick={compareNow}>Compare</button>
            </div>
          ) : null}
          {activeGroup === 'words' && !blank && !waiting ? (
            <div className="canvas-sub">
              <Segmented<WordView>
                small
                label="Track changes by"
                testId="sub"
                options={[{ id: 'inline', label: 'By word' }, { id: 'chars', label: 'By character' }]}
                value={activeView === 'chars' ? 'chars' : 'inline'}
                onChange={(next) => {
                  setWordView(next)
                  setView(next)
                }}
              />
            </div>
          ) : null}
          {activeGroup === 'structure' && !blank && !waiting ? (
            <div className="canvas-sub">
              <Segmented<StructureView>
                small
                label="Structure as"
                testId="sub"
                options={[{ id: 'tree', label: 'Tree' }, { id: 'fields', label: 'List' }]}
                value={activeView === 'fields' ? 'fields' : 'tree'}
                onChange={(next) => {
                  setStructureView(next)
                  setView(next)
                }}
              />
            </div>
          ) : null}
          {waiting ? (
            <div className="canvas-scroll">
              <div className="state welcome" data-testid="ready">
                <span className="state-icon"><CompareIcon size={22} /></span>
                <strong>Ready to compare</strong>
                <p>
                  {left.trim() === ''
                    ? 'Add a file on the Before side, then press Compare.'
                    : right.trim() === ''
                      ? 'Add a file on the After side, then press Compare.'
                      : 'Both sides are filled in. Press Compare to see the differences.'}
                </p>
                <button type="button" className="btn primary" onClick={compareNow}>Compare</button>
              </div>
            </div>
          ) : (
            <DiffCanvas
              result={result}
              view={activeView}
              mode={shownMode}
              query={query}
              showAll={showAll}
              pins={pins}
              activeId={focusDomId}
              options={shownOptions}
              blank={blank}
              onExpand={expand}
              onSelectRow={selectRow}
              onShowAll={showEverything}
            />
          )}
          {!blank && !waiting ? (
            <div className="navigator" role="toolbar" aria-label="Move between changes">
              <button type="button" className="icon-btn" aria-label="Previous change" title="Previous change · K" disabled={visibleItems.length === 0} onClick={() => move(-1)}>
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                className="nav-label"
                aria-pressed={listOpen}
                title="List every change · /"
                data-testid="nav-label"
                onClick={() => (listOpen ? closeList() : setListOpen(true))}
              >
                <ListIcon />
                <span>{navLabel}</span>
              </button>
              <button type="button" className="icon-btn" aria-label="Next change" title="Next change · J" disabled={visibleItems.length === 0} onClick={() => move(1)}>
                <ChevronRightIcon />
              </button>
            </div>
          ) : null}
          {listOpen ? (
            <Panel
              title={listTitle}
              items={visibleItems}
              counts={counts}
              query={query}
              onQuery={setQuery}
              filter={activeFilter}
              onFilter={setFilter}
              activeId={focusDomId}
              onPick={choose}
              onClose={closeList}
              searchRef={searchRef}
            />
          ) : null}
        </div>
      </section>
    </div>
  )
}
