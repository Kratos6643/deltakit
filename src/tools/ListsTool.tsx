import { useEffect, useMemo, useState } from 'react'
import { EditorPane } from '../components/EditorPane.tsx'
import { DeleteIcon, ListsIcon, WrapIcon } from '../components/Icons.tsx'
import { Segmented, type SegmentOption } from '../components/Segmented.tsx'
import { copyAndTell, downloadText } from '../lib/clipboard.ts'
import { MOD_KEY } from '../lib/keys.ts'
import { compareLists, GROUP_LABELS, LIST_IDS, type ListId, type Separator, type SetGroup } from '../lib/lists.ts'

type ListsToolProps = {
  active: boolean
  notify: (text: string) => void
}

type Count = '2' | '3'
type Texts = [string, string, string]

const SIDES = ['a', 'b', 'c'] as const
const GROUPS: SetGroup[] = ['intersection', 'union', 'only', 'difference']
const BLANK: Texts = ['', '', '']

const COUNTS: SegmentOption<Count>[] = [
  { id: '2', label: 'Two lists', title: 'Compare list A with list B' },
  { id: '3', label: 'Three lists', title: 'Compare lists A, B, and C' },
]

const SEPARATORS: SegmentOption<Separator>[] = [
  { id: 'auto', label: 'Auto', title: 'One item per line, or split on commas when a list is a single line' },
  { id: 'lines', label: 'Lines', title: 'One item per line' },
  { id: 'commas', label: 'Commas', title: 'Split on commas and on line ends' },
]

function defaultName(id: ListId): string {
  return `${id.toLowerCase()}.txt`
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`
}

function fileName(label: string): string {
  const name = label.replace(/∪/g, 'or').replace(/∩/g, 'and').replace(/−/g, 'minus').replace(/△/g, 'xor').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()
  return `${name.replace(/^-|-$/g, '')}.txt`
}

export function ListsTool({ active, notify }: ListsToolProps) {
  const [count, setCount] = useState<Count>('2')
  const [texts, setTexts] = useState<Texts>(BLANK)
  const [names, setNames] = useState<Texts>(() => LIST_IDS.map(defaultName) as Texts)
  const [run, setRun] = useState<Texts | null>(null)
  const [separator, setSeparator] = useState<Separator>('auto')
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [sort, setSort] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [picked, setPicked] = useState('')

  const size = Number(count)
  const ids = LIST_IDS.slice(0, size)
  const shown = texts.slice(0, size)
  const empty = shown.every((text) => text.trim() === '')
  if (empty && run !== null) setRun(null)
  const outdated = !empty && (run === null || shown.some((text, index) => text !== run[index]))

  // Edits to the lists wait for Compare lists. The options and the number of lists apply
  // right away, because they only change how the lists that were last compared are read.
  const comparison = useMemo(
    () => (run ? compareLists(run.slice(0, size), { ignoreCase, separator, sort }) : null),
    [run, size, ignoreCase, separator, sort],
  )
  const operations = comparison?.operations ?? []
  const operation = operations.find((item) => item.id === picked) ?? operations.find((item) => item.id === `intersection-${ids.join('')}`)
  const output = operation ? operation.items.join('\n') : ''
  const outputName = operation ? fileName(operation.label) : 'result.txt'
  const stale = outdated && comparison !== null

  function setText(index: number, text: string) {
    setTexts((current) => current.map((item, at) => (at === index ? text : item)) as Texts)
  }

  function setName(index: number, name: string) {
    setNames((current) => current.map((item, at) => (at === index ? name : item)) as Texts)
  }

  function compareNow() {
    if (empty) return
    if (!outdated) {
      notify('The result is already up to date')
      return
    }
    setRun(texts)
  }

  function clearAll() {
    setTexts(BLANK)
    setNames(LIST_IDS.map(defaultName) as Texts)
  }

  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      compareNow()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="page" hidden={!active} data-testid="page-lists">
      <header className="page-head">
        <div className="page-title">
          <p className="eyebrow">Lists</p>
          <h1>Compare lists as sets</h1>
          <p className="page-lead">Paste a list into each pane, one item per line or separated by commas, then press Compare lists.</p>
        </div>
        <div className="page-controls">
          <Segmented label="Number of lists" testId="count" options={COUNTS} value={count} onChange={setCount} />
        </div>
      </header>

      <div className="inputs">
        <section className="splitbox" aria-label="Lists to compare">
          <div className="splitbox-toolbar">
            <div className="tb-group">
              <span className="tool-row-label" id="lists-separator">Items split by</span>
              <Segmented small label="Items split by" testId="separator" options={SEPARATORS} value={separator} onChange={setSeparator} />
            </div>
            <div className="tb-group">
              <button type="button" className="tb-btn" aria-pressed={ignoreCase} title="Treat “Apple” and “apple” as the same item" data-testid="lists-case" onClick={() => setIgnoreCase((on) => !on)}>
                Ignore case
              </button>
              <button type="button" className="tb-btn" aria-pressed={sort} title="Sort each result from A to Z, with numbers in order" data-testid="lists-sort" onClick={() => setSort((on) => !on)}>
                Sort results
              </button>
              <button type="button" className="tb-btn" aria-pressed={wrap} title="Fold long lines to fit the pane" onClick={() => setWrap((on) => !on)}>
                <WrapIcon size={14} />
                Soft wrap
              </button>
              <button type="button" className="tb-btn is-danger" title="Clear every list" disabled={texts.every((text) => text === '')} onClick={clearAll}>
                <DeleteIcon size={14} />
                Clear
              </button>
            </div>
          </div>
          <div className={`list-panes is-${count}`}>
            {ids.map((id, index) => (
              <EditorPane
                key={id}
                side={SIDES[index]}
                name={names[index]}
                text={texts[index]}
                mode="text"
                modeLabel="list"
                wrap={wrap}
                empty={{ title: `Paste list ${id}`, body: 'One item per line, or separated by commas' }}
                onText={(text) => setText(index, text)}
                onFile={(name, text) => {
                  setText(index, text)
                  setName(index, name)
                }}
                onClear={() => {
                  setText(index, '')
                  setName(index, defaultName(id))
                }}
                onCopy={() => copyAndTell(texts[index], `List ${id}`, notify)}
              />
            ))}
          </div>
          <div className="splitbox-status">
            <span className="status-facts" data-testid="lists-facts">
              {comparison
                ? comparison.lists.map((list) => (
                  <span key={list.id} title={list.duplicates.length > 0 ? `Repeated: ${list.duplicates.slice(0, 20).join(', ')}` : undefined}>
                    {list.id} <b>{plural(list.unique, 'item')}</b>
                    {list.total > list.unique ? ` · ${plural(list.total - list.unique, 'repeat')} skipped` : ''}
                  </span>
                ))
                : <span>Repeated items count once</span>}
            </span>
          </div>
        </section>
        <div className="bridge">
          <div className="bridge-side is-start" />
          <button
            type="button"
            className={`btn primary compare${outdated ? ' is-due' : ''}`}
            data-testid="lists-compare"
            disabled={empty}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            title={empty ? 'Add items to a list first' : `Compare the lists · ${MOD_KEY} Enter`}
            onClick={compareNow}
          >
            Compare lists
            <kbd aria-hidden="true">{MOD_KEY} ↵</kbd>
          </button>
          <div className="bridge-side is-end" />
        </div>
      </div>

      <section className={`sets${stale ? ' is-stale' : ''}`} aria-label="Results" data-testid="sets">
        {comparison && operation ? (
          <>
            {stale ? (
              <div className="stale-bar">
                <span>This result is from before your latest edits.</span>
                <button type="button" className="btn primary small" onClick={compareNow}>Compare lists</button>
              </div>
            ) : null}
            <div className="sets-body">
              <nav className="sets-ops" aria-label="Set operations">
                {GROUPS.map((group) => {
                  const items = operations.filter((item) => item.group === group)
                  if (items.length === 0) return null
                  return (
                    <div key={group} className="sets-group" role="group" aria-label={GROUP_LABELS[group]}>
                      <span className="sets-group-label">{GROUP_LABELS[group]}</span>
                      <div className="field-chips">
                        {items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="chip set-chip"
                            aria-pressed={item.id === operation.id}
                            title={item.description}
                            data-testid={`set-${item.id}`}
                            onClick={() => setPicked(item.id)}
                          >
                            {item.label} <em>{item.items.length.toLocaleString()}</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </nav>
              <div className="sets-result">
                <header className="details-head">
                  <span className="details-badge"><ListsIcon size={18} /></span>
                  <div className="details-title">
                    <strong data-testid="set-title">{operation.label}</strong>
                    <span data-testid="set-summary">{operation.description} · {plural(operation.items.length, 'item')}</span>
                  </div>
                </header>
                <div className="sets-pane">
                  <EditorPane
                    side="output"
                    name={outputName}
                    text={output}
                    mode="text"
                    modeLabel="list"
                    wrap={wrap}
                    readOnly
                    empty={{ title: 'No items', body: `Nothing matches ${operation.label}` }}
                    onCopy={() => copyAndTell(output, operation.label, notify)}
                    onDownload={() => {
                      downloadText(outputName, `${output}\n`)
                      notify(`Saved ${outputName}`)
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="state welcome" data-testid="sets-ready">
            <span className="state-icon"><ListsIcon size={22} /></span>
            <strong>{empty ? 'Compare two or three lists' : 'Ready to compare'}</strong>
            <p>
              {empty
                ? 'Paste a list into each pane above. DeltaKit shows what the lists share, what is only in one, and everything combined.'
                : 'Press Compare lists to see unions, intersections, and differences.'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
