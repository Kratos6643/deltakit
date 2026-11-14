import { useState, type RefObject } from 'react'
import type { ChangeFilter } from '../lib/tone.ts'
import { toneClass, toneGroup } from '../lib/tone.ts'
import { CloseIcon, SearchIcon } from './Icons.tsx'

export type ChangeItem = {
  id: string
  domId: string
  kind: string
  title: string
  detail: string
  rowIndex?: number
}

const FILTERS: ChangeFilter[] = ['all', 'added', 'removed', 'changed', 'moved']
const LABELS: Record<ChangeFilter, string> = {
  all: 'All',
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  moved: 'Moved',
}
const STEP = 400

type ChangesPanelProps = {
  title: string
  items: ChangeItem[]
  counts: Record<ChangeFilter, number>
  query: string
  onQuery: (query: string) => void
  filter: ChangeFilter
  onFilter: (filter: ChangeFilter) => void
  activeId: string | null
  onPick: (item: ChangeItem) => void
  onClose: () => void
  searchRef: RefObject<HTMLInputElement | null>
}

export function ChangesPanel({ title, items, counts, query, onQuery, filter, onFilter, activeId, onPick, onClose, searchRef }: ChangesPanelProps) {
  const [limit, setLimit] = useState({ items, count: STEP })
  if (limit.items !== items) setLimit({ items, count: STEP })
  const activeIndex = items.findIndex((item) => item.domId === activeId)
  const shown = Math.max(limit.items === items ? limit.count : STEP, activeIndex + 1)

  return (
    <aside className="panel" aria-label="List of changes" data-testid="changes-panel">
      <header className="panel-head">
        <h2>{title}</h2>
        <span className="count">{items.length.toLocaleString()}</span>
        <button type="button" className="icon-btn" aria-label="Close the list" title="Close · Esc" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <label className="search">
        <SearchIcon />
        <span className="sr-only">Find a change</span>
        <input ref={searchRef} value={query} placeholder="Find a change" onChange={(event) => onQuery(event.target.value)} />
      </label>
      <div className="chips" role="group" aria-label="Show changes of one type">
        {FILTERS.filter((item) => item === 'all' || counts[item] > 0).map((item) => (
          <button
            key={item}
            type="button"
            className={`chip${item === 'all' ? '' : ` ${toneClass(item)}`}`}
            aria-pressed={filter === item}
            onClick={() => onFilter(item)}
          >
            {LABELS[item]} <em>{counts[item].toLocaleString()}</em>
          </button>
        ))}
      </div>
      <div className="item-list">
        {items.length === 0 ? <p className="empty-list">Nothing matches this filter.</p> : null}
        {items.slice(0, shown).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`item${activeId === item.domId ? ' is-active' : ''}`}
            onClick={() => onPick(item)}
          >
            <span className={`item-dot ${toneClass(item.kind)}`} aria-hidden="true" />
            <span className="item-body">
              <strong>{item.title}</strong>
              {item.detail ? <small>{item.detail}</small> : null}
            </span>
            <span className={`item-kind ${toneClass(item.kind)}`}>{LABELS[toneGroup(item.kind)]}</span>
          </button>
        ))}
        {items.length > shown ? (
          <button type="button" className="show-more" onClick={() => setLimit({ items, count: shown + STEP })}>
            Show {Math.min(STEP, items.length - shown).toLocaleString()} more
            <span>{(items.length - shown).toLocaleString()} remaining</span>
          </button>
        ) : null}
      </div>
    </aside>
  )
}
