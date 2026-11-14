import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ArrowIcon, BoltIcon, ChipIcon, ClockIcon, CompareIcon, ConvertIcon, DecodeIcon, FileIcon, ListsIcon, LockIcon, type Icon } from '../components/Icons.tsx'
import type { DataFormat } from '../lib/convert.ts'
import type { DecodeKind } from '../lib/decode.ts'
import { formatBytes, MAX_BYTES, readTextFile, TEXT_ACCEPT } from '../lib/files.ts'
import { isTyping } from '../lib/keys.ts'
import { followLink, PATHS, type Handoff, type Page, type Tool } from '../lib/routes.ts'

type Incoming = Handoff['files'][number]

type HomePageProps = {
  active: boolean
  onPage: (page: Page) => void
  onOpen: (tool: Tool, files: Incoming[]) => void
  notify: (text: string) => void
}

type Choice = { file: Incoming; format: DataFormat | null; encoding: DecodeKind | null }

const LAUNCH: { id: Tool; label: string; key: string; icon: Icon }[] = [
  { id: 'compare', label: 'Compare files', key: '1', icon: CompareIcon },
  { id: 'convert', label: 'Convert data', key: '2', icon: ConvertIcon },
  { id: 'decode', label: 'Decode text', key: '3', icon: DecodeIcon },
  { id: 'lists', label: 'Compare lists', key: '4', icon: ListsIcon },
]

const CARDS: { id: Tool; icon: Icon; title: string; body: string; meta: string; link: string; preview: ReactNode }[] = [
  {
    id: 'compare',
    icon: CompareIcon,
    title: 'Compare and diff',
    body: 'See every change side by side, inline, or as data. List items match by id, key order can be skipped, and fields such as updatedAt can be left out.',
    meta: 'Text / JSON / XML / YAML / CSV',
    link: 'Compare',
    preview: (
      <div className="sample sample-diff">
        <span><b>07</b>{'  "id": "A-1042",'}</span>
        <span className="is-del"><b>-08</b>{'  "status": "pending",'}</span>
        <span className="is-add"><b>+08</b>{'  "status": "shipped",'}</span>
      </div>
    ),
  },
  {
    id: 'convert',
    icon: ConvertIcon,
    title: 'Convert between formats',
    body: 'Turn JSON, YAML, XML, and CSV into each other. Nested fields become dotted columns, and XML attributes return as attributes on the way back.',
    meta: 'JSON / YAML / XML / CSV',
    link: 'Convert',
    preview: (
      <div className="sample sample-convert">
        <span className="sample-row">
          <span className="sample-chip">JSON</span>
          <span className="sample-arrow">→</span>
          <span className="sample-chip">YAML</span>
          <span className="sample-good">Both ways</span>
        </span>
        <span className="sample-row">
          <span>Nested keys → columns</span>
          <span className="sample-key">address.city</span>
        </span>
      </div>
    ),
  },
  {
    id: 'decode',
    icon: DecodeIcon,
    title: 'Decode tokens and text',
    body: 'Read the header, claims, and expiry of a JWT, preview images inside Base64, and list every query parameter in a link.',
    meta: 'JWT / Base64 / URL',
    link: 'Decode',
    preview: (
      <div className="sample sample-decode">
        <span className="sample-row"><span className="is-head">eyJhbGciOiJIUzI1NiJ9</span><small>Header</small></span>
        <span className="sample-row"><span className="is-claims">eyJzdWIiOiJhZGEifQ</span><small>Claims</small></span>
        <span className="sample-row is-good"><ClockIcon size={12} />Expires in 2 hours</span>
      </div>
    ),
  },
  {
    id: 'lists',
    icon: ListsIcon,
    title: 'Compare lists as sets',
    body: 'Paste two or three lists to see what they share and what is only in one. Unions, intersections, and differences are a click apart.',
    meta: 'A ∪ B / A ∩ B / A − B',
    link: 'Lists',
    preview: (
      <div className="sample sample-sets">
        <span className="sample-row"><span className="sample-chip">A ∩ B</span><span>in both lists</span><span className="sample-key">128</span></span>
        <span className="sample-row"><span className="sample-chip">Only A</span><span>missing from B</span><span className="sample-key">7</span></span>
        <span className="sample-row"><span className="sample-chip">A ∪ B ∪ C</span><span>everything, once</span><span className="sample-key">214</span></span>
      </div>
    ),
  },
]

const STATS: { icon: Icon; tone: 'good' | 'accent'; title: string; body: string }[] = [
  { icon: LockIcon, tone: 'good', title: '0 bytes uploaded', body: 'Files never leave your browser' },
  { icon: ChipIcon, tone: 'accent', title: 'Background worker', body: 'Big files stay responsive' },
  { icon: BoltIcon, tone: 'good', title: '5 MB per file', body: 'Paste, drop, or open from disk' },
]

function formatLabel(format: DataFormat): string {
  return format.toUpperCase()
}

// The detectors ship with Convert and Decode, which load while the page is idle.
async function choiceFor(file: Incoming): Promise<Choice> {
  const [{ sniffFormat }, { sniffEncoding }] = await Promise.all([import('../lib/convert.ts'), import('../lib/decode.ts')])
  const format = sniffFormat(file.name ?? '', file.text)
  return { file, format, encoding: format ? null : sniffEncoding(file.text) }
}

export function HomePage({ active, onPage, onOpen, notify }: HomePageProps) {
  const [over, setOver] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function receive(files: Incoming[]) {
    setProblem(null)
    if (files.length >= 2) {
      setChoice(null)
      onOpen('compare', files.slice(0, 2))
      if (files.length > 2) notify(`Opened the first two of ${files.length} files`)
      return
    }
    const next = await choiceFor(files[0]).catch(() => null)
    if (!next) {
      setChoice(null)
      setProblem('DeltaKit could not finish loading. Reload the page and try again.')
      return
    }
    if (next.encoding) {
      setChoice(null)
      onOpen('decode', [next.file])
      return
    }
    setChoice(next)
  }

  async function readFiles(list: FileList | null | undefined) {
    const files = Array.from(list ?? [])
    if (files.length === 0) return
    try {
      await receive(await Promise.all(files.map(async (file) => ({ name: file.name, text: await readTextFile(file) }))))
    } catch (error) {
      setChoice(null)
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  function take(tool: Tool) {
    if (!choice) return
    setChoice(null)
    onOpen(tool, [choice.file])
  }

  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      const launch = LAUNCH.find((item) => item.key === event.key)
      if (!launch) return
      event.preventDefault()
      onPage(launch.id)
    }
    function onPaste(event: ClipboardEvent) {
      if (isTyping(event.target)) return
      const text = event.clipboardData?.getData('text') ?? ''
      if (text.trim() === '') return
      event.preventDefault()
      if (text.length > MAX_BYTES) {
        setProblem(`That paste is larger than ${formatBytes(MAX_BYTES)}. Open the file instead.`)
        return
      }
      void receive([{ text }])
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('paste', onPaste)
    }
  })

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setOver(false)
    void readFiles(event.dataTransfer.files)
  }

  return (
    <div className="page home" hidden={!active} data-testid="page-home">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow-pill">
            <span className="status-dot" aria-hidden="true" />
            DeltaKit by Avinash Rapolu
            <span className="eyebrow-sep" aria-hidden="true">/</span>
            <span className="eyebrow-mono">Browser only</span>
          </p>
          <h1>Compare, convert, and decode data, <span className="hero-accent">entirely in your browser.</span></h1>
          <p className="hero-lead">
            Find what changed between two files, turn JSON into YAML, XML, or CSV, read JWTs, Base64, and encoded links,
            and see what two or three lists share.
            Everything happens on this device.
          </p>
          <div className="hero-actions">
            {LAUNCH.map((item, index) => (
              <a
                key={item.id}
                className={`btn ${index === 0 ? 'primary' : 'raised'} launch`}
                href={PATHS[item.id]}
                aria-keyshortcuts={item.key}
                data-testid={`launch-${item.id}`}
                onClick={(event) => followLink(event, onPage, item.id)}
              >
                <item.icon size={16} />
                {item.label}
                <kbd aria-hidden="true">{item.key}</kbd>
              </a>
            ))}
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span><b>01</b><i />text · json · xml · yaml · csv</span>
          <span className="is-lit"><b>02</b><i />json ↔ yaml ↔ xml ↔ csv</span>
          <span><b>03</b><i />jwt · base64 · url</span>
          <span><b>04</b><i />a ∪ b · a ∩ b · a − b</span>
        </div>
      </section>

      <section className="home-section" aria-labelledby="tools-title">
        <div className="section-head">
          <div>
            <p className="eyebrow">Tools</p>
            <h2 id="tools-title">Four tools in one tab</h2>
          </div>
          <p className="section-note">Pick one, or drop a file below</p>
        </div>
        <div className="cards">
          {CARDS.map((card) => (
            <article key={card.id} className="card tool-card">
              <span className="tile"><card.icon size={20} /></span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              {card.preview}
              <div className="card-foot">
                <span className="card-meta">{card.meta}</span>
                <a href={PATHS[card.id]} data-testid={`card-${card.id}`} onClick={(event) => followLink(event, onPage, card.id)}>
                  {card.link}
                  <ArrowIcon size={14} />
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="home-start">
        <section className="stats" aria-label="Privacy and limits">
          {STATS.map((stat) => (
            <div key={stat.title} className="stat">
              <span className={`tile is-${stat.tone}`}><stat.icon size={18} /></span>
              <span className="stat-copy">
                <strong>{stat.title}</strong>
                <span>{stat.body}</span>
              </span>
            </div>
          ))}
        </section>

        <section
          className={`card dropzone${over ? ' is-over' : ''}`}
          aria-label="Open files"
          data-testid="dropzone"
          onDragOver={(event) => {
            event.preventDefault()
            setOver(true)
          }}
          onDragLeave={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
            setOver(false)
          }}
          onDrop={onDrop}
        >
          <span className="tile is-large"><FileIcon size={24} /></span>
          {choice ? (
            <div className="dropzone-choice" data-testid="home-choice">
              <h3>What would you like to do with {choice.file.name ?? 'the pasted text'}?</h3>
              <p>{formatBytes(new Blob([choice.file.text]).size)}{choice.format ? ` · ${formatLabel(choice.format)}` : ''}</p>
              <div className="choice-actions">
                <button type="button" className="btn primary" data-testid="choose-compare" onClick={() => take('compare')}>
                  Compare it as the Before file
                </button>
                {choice.format ? (
                  <button type="button" className="btn raised" data-testid="choose-convert" onClick={() => take('convert')}>
                    Convert this {formatLabel(choice.format)}
                  </button>
                ) : null}
                <button type="button" className="btn ghost" onClick={() => setChoice(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <h3>{over ? 'Drop to open' : 'Drop files to start'}</h3>
              <p>
                Drop two files to compare them, or one file to compare or convert it.
                Paste anywhere on this page to read a JWT, Base64, or an encoded link.
              </p>
              <p className="dropzone-browse">
                or pick them from your computer
                <button type="button" className="code-btn" onClick={() => fileRef.current?.click()}>Open files</button>
              </p>
            </>
          )}
          {problem ? <p className="dropzone-problem" role="status">{problem}</p> : null}
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={TEXT_ACCEPT}
            data-testid="home-file"
            onChange={(event) => {
              void readFiles(event.target.files)
              event.currentTarget.value = ''
            }}
          />
        </section>
      </div>
    </div>
  )
}
