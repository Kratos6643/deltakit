import { memo, useState } from 'react'
import type { CompareOptions, CompareResult, DiffRow, InlinePart, Mode, Span, ViewId } from '../types.ts'
import { CheckIcon, FileIcon } from './Icons.tsx'
import { TreeView } from './TreeView.tsx'

const ROW_STEP = 1500
const PATCH_STEP = 3000
const TABLE_STEP = 1000

const STATUS_LABELS: Record<string, string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  mixed: 'Changed',
  moved: 'Moved',
  type: 'Type changed',
  reordered: 'Key order',
  same: 'Same',
}

type DiffCanvasProps = {
  result: CompareResult
  view: ViewId
  mode: Mode
  query: string
  showAll: boolean
  pins: Set<number>
  activeId: string | null
  options: CompareOptions
  blank: boolean
  onExpand: (start: number, count: number) => void
  onSelectRow: (index: number) => void
  onShowAll: () => void
}

const FUZZY_TITLE = 'This line differs only in what Options ignores'

type Block =
  | { type: 'rows'; rows: { row: DiffRow; index: number }[] }
  | { type: 'fold'; start: number; count: number }

function useLimit(step: number, resetKey: unknown): [number, () => void] {
  const [state, setState] = useState({ key: resetKey, limit: step })
  if (state.key !== resetKey) setState({ key: resetKey, limit: step })
  const limit = state.key === resetKey ? state.limit : step
  return [limit, () => setState((current) => ({ key: current.key, limit: current.limit + step }))]
}

function matches(row: DiffRow, q: string): boolean {
  return q.length > 0 && `${row.left ?? ''}\n${row.right ?? ''}`.toLowerCase().includes(q)
}

function blocksFor(rows: DiffRow[], showAll: boolean, pins: Set<number>, q: string): Block[] {
  const visible = rows.map((row, index) => showAll || pins.has(index) || row.kind !== 'equal' || matches(row, q))
  if (!showAll) {
    rows.forEach((row, index) => {
      if (row.kind !== 'equal' || pins.has(index) || matches(row, q)) {
        for (let neighbor = Math.max(0, index - 2); neighbor <= Math.min(rows.length - 1, index + 2); neighbor += 1) {
          visible[neighbor] = true
        }
      }
    })
    let index = 0
    while (index < rows.length) {
      if (visible[index]) {
        index += 1
        continue
      }
      const start = index
      while (index < rows.length && !visible[index]) index += 1
      if (index - start <= 2) {
        for (let cursor = start; cursor < index; cursor += 1) visible[cursor] = true
      }
    }
  }
  const blocks: Block[] = []
  let index = 0
  while (index < rows.length) {
    if (visible[index]) {
      const chunk: { row: DiffRow; index: number }[] = []
      while (index < rows.length && visible[index]) {
        chunk.push({ row: rows[index], index })
        index += 1
      }
      blocks.push({ type: 'rows', rows: chunk })
    } else {
      const start = index
      while (index < rows.length && !visible[index]) index += 1
      blocks.push({ type: 'fold', start, count: index - start })
    }
  }
  return blocks
}

function rowPosition(blocks: Block[], rowIndex: number): number {
  let position = 0
  for (const block of blocks) {
    if (block.type === 'fold') {
      position += 1
      continue
    }
    for (const item of block.rows) {
      if (item.index === rowIndex) return position
      position += 1
    }
  }
  return -1
}

function limitBlocks(blocks: Block[], limit: number): { shown: Block[]; hidden: number } {
  const shown: Block[] = []
  let used = 0
  let hidden = 0
  for (const block of blocks) {
    const size = block.type === 'fold' ? 1 : block.rows.length
    if (used >= limit) {
      if (block.type === 'rows') hidden += size
      continue
    }
    if (block.type === 'rows' && used + size > limit) {
      const room = limit - used
      shown.push({ type: 'rows', rows: block.rows.slice(0, room) })
      hidden += size - room
      used = limit
      continue
    }
    shown.push(block)
    used += size
  }
  return { shown, hidden }
}

function ShowMore({ hidden, step, unit, onMore }: { hidden: number; step: number; unit: string; onMore: () => void }) {
  if (hidden <= 0) return null
  return (
    <button type="button" className="show-more" onClick={onMore}>
      Show {Math.min(step, hidden).toLocaleString()} more {unit}
      <span>{hidden.toLocaleString()} remaining</span>
    </button>
  )
}

function LineBody({ text, spans }: { text?: string; spans?: Span[] }) {
  if (text === undefined) return null
  if (text.length === 0) return <span className="blank" aria-label="blank line">↵</span>
  if (!spans) return <>{text}</>
  return spans.map((span, index) => (
    span.changed
      ? <mark key={index} className="word">{span.text}</mark>
      : <span key={index}>{span.text}</span>
  ))
}

function Fold({ start, count, onExpand }: { start: number; count: number; onExpand: (start: number, count: number) => void }) {
  return (
    <button type="button" className="fold" onClick={() => onExpand(start, count)}>
      <span aria-hidden="true">⋯</span>
      {count.toLocaleString()} unchanged {count === 1 ? 'line' : 'lines'}
      <span className="fold-action">Show</span>
    </button>
  )
}

function rowClass(row: DiffRow, index: number, activeId: string | null, q: string): string {
  return [
    'row',
    `line-${row.kind}`,
    row.fuzzy ? 'is-fuzzy' : '',
    activeId === `diff-row-${index}` ? 'is-active' : '',
    matches(row, q) ? 'is-hit' : '',
  ].filter(Boolean).join(' ')
}

type LineViewProps = {
  blocks: Block[]
  activeId: string | null
  q: string
  sortLines: boolean
  limit: number
  onMore: () => void
  onExpand: (start: number, count: number) => void
  onSelectRow: (index: number) => void
}

function SplitView({ blocks, activeId, q, sortLines, limit, onMore, onExpand, onSelectRow }: LineViewProps) {
  const { shown, hidden } = limitBlocks(blocks, limit)
  return (
    <div className={`diff split${sortLines ? ' is-sorted' : ''}`} aria-label="Side by side comparison">
      {shown.map((block) => {
        if (block.type === 'fold') return <Fold key={`fold-${block.start}`} start={block.start} count={block.count} onExpand={onExpand} />
        return block.rows.map(({ row, index }) => (
          <div
            key={index}
            id={`diff-row-${index}`}
            className={rowClass(row, index, activeId, q)}
            title={row.fuzzy ? FUZZY_TITLE : undefined}
            onClick={() => onSelectRow(index)}
          >
            <span className="no">{row.leftNo ?? ''}</span>
            <span className={`cell left${row.left === undefined ? ' is-gap' : ''}`}><LineBody text={row.left} spans={row.leftSpans} /></span>
            <span className="no right">{row.rightNo ?? ''}</span>
            <span className={`cell right${row.right === undefined ? ' is-gap' : ''}`}><LineBody text={row.right} spans={row.rightSpans} /></span>
          </div>
        ))
      })}
      <ShowMore hidden={hidden} step={ROW_STEP} unit="lines" onMore={onMore} />
    </div>
  )
}

function UnifiedView({ blocks, activeId, q, sortLines, limit, onMore, onExpand, onSelectRow }: LineViewProps) {
  const { shown, hidden } = limitBlocks(blocks, limit)
  return (
    <div className={`diff unified${sortLines ? ' is-sorted' : ''}`} aria-label="Inline comparison">
      {shown.map((block) => {
        if (block.type === 'fold') return <Fold key={`fold-${block.start}`} start={block.start} count={block.count} onExpand={onExpand} />
        return block.rows.map(({ row, index }) => {
          const active = activeId === `diff-row-${index}`
          if (row.kind === 'modify') {
            return (
              <div key={index} id={`diff-row-${index}`} className={`pair${matches(row, q) ? ' is-hit' : ''}${active ? ' is-active' : ''}`} onClick={() => onSelectRow(index)}>
                <div className="row line-remove">
                  <span className="no">{row.leftNo}</span>
                  <span className="sign">−</span>
                  <span className="cell"><LineBody text={row.left} spans={row.leftSpans} /></span>
                </div>
                <div className="row line-add">
                  <span className="no">{row.rightNo}</span>
                  <span className="sign">+</span>
                  <span className="cell"><LineBody text={row.right} spans={row.rightSpans} /></span>
                </div>
              </div>
            )
          }
          const sign = row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ''
          return (
            <div key={index} id={`diff-row-${index}`} className={rowClass(row, index, activeId, q)} title={row.fuzzy ? FUZZY_TITLE : undefined} onClick={() => onSelectRow(index)}>
              <span className="no">{row.leftNo ?? row.rightNo ?? ''}</span>
              <span className="sign">{sign}</span>
              <span className="cell"><LineBody text={row.kind === 'add' ? row.right : row.left} spans={row.kind === 'add' ? row.rightSpans : row.leftSpans} /></span>
            </div>
          )
        })
      })}
      <ShowMore hidden={hidden} step={ROW_STEP} unit="lines" onMore={onMore} />
    </div>
  )
}

function Unavailable({ title, note }: { title: string; note?: string }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {note ? <p>{note}</p> : null}
    </div>
  )
}

function StreamView({ parts, note, prose }: { parts: InlinePart[] | null; note?: string; prose: boolean }) {
  if (!parts) return <Unavailable title="Not available for these files" note={note} />
  return (
    <pre className={`stream${prose ? ' is-prose' : ''}`}>
      {parts.map((part, index) => (
        part.kind === 'equal'
          ? <span key={index}>{part.text}</span>
          : part.kind === 'add'
            ? <ins key={index}>{part.text}</ins>
            : <del key={index}>{part.text}</del>
      ))}
    </pre>
  )
}

function PatchView({ patch, limit, onMore }: { patch: string; limit: number; onMore: () => void }) {
  if (patch.length === 0) return <Unavailable title="No patch" note="A patch appears once the two sides differ." />
  const lines = patch.endsWith('\n') ? patch.slice(0, -1).split('\n') : patch.split('\n')
  return (
    <div className="patch">
      <pre>
        {lines.slice(0, limit).map((line, index) => {
          let tone = ''
          if (line.startsWith('@@')) tone = 'hunk'
          else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) tone = 'meta'
          else if (line.startsWith('+')) tone = 'add'
          else if (line.startsWith('-')) tone = 'del'
          return <div key={index} className={tone}>{line || ' '}</div>
        })}
      </pre>
      <ShowMore hidden={lines.length - limit} step={PATCH_STEP} unit="patch lines" onMore={onMore} />
    </div>
  )
}

function FieldsView({ result, q, showAll, activeId, limit, onMore }: { result: CompareResult; q: string; showAll: boolean; activeId: string | null; limit: number; onMore: () => void }) {
  const rows = result.fields.filter((field) => {
    if (!showAll && field.status === 'same' && !field.reordered) return false
    if (!q) return true
    return `${field.path} ${field.left ?? ''} ${field.right ?? ''} ${field.note ?? ''}`.toLowerCase().includes(q)
  })
  if (rows.length === 0 && q) return <Unavailable title={`No fields match “${q}”`} />
  if (rows.length === 0) return <Unavailable title="No changed fields" note={showAll ? undefined : 'Turn on Show unchanged to list every field.'} />
  const activeIndex = rows.findIndex((field) => `field-${encodeURIComponent(field.id)}` === activeId)
  const visible = rows.slice(0, Math.max(limit, activeIndex + 1))
  return (
    <div className="table-wrap">
      <table className="data fields">
        <thead>
          <tr>
            <th>Status</th>
            <th>Path</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((field) => {
            const domId = `field-${encodeURIComponent(field.id)}`
            const status = field.typeChange ? 'type' : field.reordered ? 'reordered' : field.status
            return (
              <tr key={field.id} id={domId} className={`${status}${activeId === domId ? ' is-active' : ''}`}>
                <td><span className={`status-pill ${status}`}>{STATUS_LABELS[status] ?? status}</span>{field.note ? <small>{field.note}</small> : null}</td>
                <td className="path">{field.path}</td>
                <td className="before">{field.left ?? ''}</td>
                <td className="after">{field.right ?? ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ShowMore hidden={rows.length - visible.length} step={TABLE_STEP} unit="fields" onMore={onMore} />
    </div>
  )
}

function GridView({ result, q, showAll, activeId, limit, onMore }: { result: CompareResult; q: string; showAll: boolean; activeId: string | null; limit: number; onMore: () => void }) {
  const grid = result.grid
  if (!grid) return <Unavailable title="No table in these files" note="Table view appears for CSV and for lists of objects." />
  const rows = grid.rows.filter((row) => {
    if (!showAll && row.status === 'same') return false
    if (!q) return true
    const blob = `${row.label} ${row.note ?? ''} ${row.cells.map((cell) => `${cell.before ?? ''} ${cell.text}`).join(' ')}`
    return blob.toLowerCase().includes(q)
  })
  const identical = grid.rows.length - grid.rows.filter((row) => row.status !== 'same').length
  if (rows.length === 0 && q) return <Unavailable title={`No rows match “${q}”`} />
  if (rows.length === 0) return <Unavailable title="Every row matches" note={showAll ? undefined : 'Turn on Show unchanged to see the full table.'} />
  const activeIndex = rows.findIndex((row) => `grid-${encodeURIComponent(row.id)}` === activeId)
  const visible = rows.slice(0, Math.max(limit, activeIndex + 1))
  return (
    <div className="table-wrap">
      <p className="table-caption">
        <span>
          <code>{grid.path}</code>
          {grid.key ? <span className="caption-key" data-testid="grid-key">rows matched by <b>{grid.key}</b></span> : null}
        </span>
        {!showAll && identical > 0 ? <span>{identical.toLocaleString()} matching {identical === 1 ? 'row' : 'rows'} hidden</span> : null}
      </p>
      <table className="data grid">
        <thead>
          <tr>
            <th>Row</th>
            {grid.columns.map((column) => (
              <th key={column.name} className={column.status}>{column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const domId = `grid-${encodeURIComponent(row.id)}`
            return (
              <tr key={row.id} id={domId} className={`${row.status}${activeId === domId ? ' is-active' : ''}`}>
                <th>
                  {row.label}
                  {row.note ? <small>{row.note}</small> : null}
                </th>
                {row.cells.map((cell, index) => (
                  <td key={`${row.id}-${index}`} className={cell.status}>
                    {cell.before !== undefined ? <s>{cell.before}</s> : null}
                    <span>{cell.text}</span>
                    {cell.typeLabel ? <em>{cell.typeLabel}</em> : null}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      <ShowMore hidden={rows.length - visible.length} step={TABLE_STEP} unit="rows" onMore={onMore} />
    </div>
  )
}

function Banners({ result, view, mode, options }: { result: CompareResult; view: ViewId; mode: Mode; options: CompareOptions }) {
  const { sortLines, ignoreFormatting } = options
  const lineView = view === 'split' || view === 'unified' || view === 'inline' || view === 'chars' || view === 'patch'
  const csv = mode === 'csv'
  const messages: { text: string; tone?: 'warn' }[] = result.notices.map((text) => ({ text, tone: 'warn' }))
  for (const text of result.info) messages.push({ text })
  if (lineView && sortLines) {
    messages.push({ text: 'Line order is ignored: both sides were sorted first, so the lines shown are the ones missing on one side.' })
  }
  if (lineView && mode !== 'text' && ignoreFormatting && options.ignoreListOrder) {
    messages.push({ text: csv ? 'Row order is ignored: rows were sorted before the lines were compared.' : 'List order is ignored: lists were sorted before the lines were compared.' })
  }
  if (lineView && mode !== 'text' && !ignoreFormatting && (options.ignoreFields.length > 0 || options.ignoreListOrder)) {
    messages.push({
      text: csv
        ? 'These lines show the files as written. Ignored columns and row order apply in Table, and here once Compare the data only is on.'
        : 'These lines show the files as written. Ignored fields and list order apply in Structure and Table, and here once Compare the data only is on.',
    })
  }
  if (lineView && result.approximate) {
    messages.push({ text: 'These files differ in many places, so lines were matched by their unique content. Small matches between distant lines may show as separate edits.' })
  }
  if ((view === 'inline' || view === 'chars') && mode !== 'text' && !sortLines) {
    messages.push({ text: 'Track changes follows the text in order. Structure and Table match the data by key.' })
  }
  if ((view === 'inline' || view === 'chars') && options.ignoreText.length > 0) {
    messages.push({ text: 'Track changes marks every edit, including text that matches the ignore patterns.' })
  }
  if (view === 'patch') {
    if (sortLines) messages.push({ text: 'This patch describes the sorted lines, so it applies to sorted copies of the files.' })
    else if (mode !== 'text' && ignoreFormatting) messages.push({ text: 'This patch compares the formatted documents, as shown in Side by side.' })
    if (result.rows.some((row) => row.fuzzy)) messages.push({ text: 'Lines that differ only in what Options ignores are kept as context.' })
  }
  if (messages.length === 0) return null
  return (
    <div className="banners">
      {messages.map((message) => (
        <p key={message.text} className={`banner${message.tone === 'warn' ? ' is-warn' : ''}`}>{message.text}</p>
      ))}
    </div>
  )
}

export const DiffCanvas = memo(function DiffCanvas({
  result,
  view,
  mode,
  query,
  showAll,
  pins,
  activeId,
  options,
  blank,
  onExpand,
  onSelectRow,
  onShowAll,
}: DiffCanvasProps) {
  const sortLines = options.sortLines
  const [rowLimit, moreRows] = useLimit(ROW_STEP, result)
  const [patchLimit, morePatch] = useLimit(PATCH_STEP, result)
  const [tableLimit, moreTable] = useLimit(TABLE_STEP, result)
  const q = query.trim().toLowerCase()
  const lineView = view === 'split' || view === 'unified'
  const blocks = lineView ? blocksFor(result.rows, showAll, pins, q) : []
  const activeRow = activeId?.startsWith('diff-row-') ? Number(activeId.slice('diff-row-'.length)) : -1
  const position = lineView && activeRow >= 0 ? rowPosition(blocks, activeRow) : -1
  const effectiveRows = Math.max(rowLimit, position + 40)
  const calm = result.hunks.length === 0 && !result.leftError && !result.rightError
  const textual = view !== 'tree' && view !== 'fields' && view !== 'grid'

  if (blank) {
    return (
      <div className="canvas-scroll" data-testid="diff-canvas">
        <div className="state welcome">
          <span className="state-icon"><FileIcon size={22} /></span>
          <strong>Compare two files</strong>
          <p>Paste text or drop a file into each side above, then press Compare. Everything stays in your browser.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="canvas-scroll" data-testid="diff-canvas">
      <Banners result={result} view={view} mode={mode} options={options} />
      {calm && textual ? (
        <div className="state calm">
          <span className="state-icon"><CheckIcon size={22} /></span>
          <strong>No differences</strong>
          <p>
            Both sides match
            {result.stats.fieldMatch !== null ? `, including ${result.stats.fieldMatch}% of fields` : ''}.
          </p>
          {!showAll && view !== 'patch' && result.rows.length > 0 ? <button type="button" className="btn" onClick={onShowAll}>Show the full file</button> : null}
        </div>
      ) : null}
      {view === 'split' ? <SplitView blocks={blocks} activeId={activeId} q={q} sortLines={sortLines} limit={effectiveRows} onMore={moreRows} onExpand={onExpand} onSelectRow={onSelectRow} /> : null}
      {view === 'unified' ? <UnifiedView blocks={blocks} activeId={activeId} q={q} sortLines={sortLines} limit={effectiveRows} onMore={moreRows} onExpand={onExpand} onSelectRow={onSelectRow} /> : null}
      {view === 'inline' && !calm ? <StreamView parts={result.inline} note={result.inlineNote} prose={mode === 'text'} /> : null}
      {view === 'chars' && !calm ? <StreamView parts={result.chars} note={result.charsNote} prose={mode === 'text'} /> : null}
      {view === 'tree' && result.tree ? <TreeView tree={result.tree} query={q} showAll={showAll} activeId={activeId} /> : null}
      {view === 'tree' && !result.tree ? <Unavailable title="Structure needs valid data on both sides" note="The messages above describe what could not be read." /> : null}
      {view === 'fields' ? <FieldsView result={result} q={q} showAll={showAll} activeId={activeId} limit={tableLimit} onMore={moreTable} /> : null}
      {view === 'grid' ? <GridView result={result} q={q} showAll={showAll} activeId={activeId} limit={tableLimit} onMore={moreTable} /> : null}
      {view === 'patch' && !calm ? <PatchView patch={result.patch} limit={patchLimit} onMore={morePatch} /> : null}
    </div>
  )
})
