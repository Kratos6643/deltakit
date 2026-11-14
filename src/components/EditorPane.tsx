import { useMemo, useRef, useState } from 'react'
import { formatBytes, MAX_BYTES, readTextFile, TEXT_ACCEPT } from '../lib/files.ts'
import type { Mode } from '../types.ts'
import { CodeEditor } from './CodeEditor.tsx'
import { CloseIcon, CopyIcon, DownloadIcon, FileIcon, OpenIcon } from './Icons.tsx'

type Side = 'before' | 'after' | 'input' | 'output' | 'a' | 'b' | 'c'

const LABELS: Record<Side, string> = { before: 'Before', after: 'After', input: 'Input', output: 'Result', a: 'List A', b: 'List B', c: 'List C' }

type EditorPaneProps = {
  side: Side
  name: string
  text: string
  mode: Mode
  modeLabel: string
  error?: string
  note?: string
  readOnly?: boolean
  stale?: boolean
  wrap?: boolean
  empty?: { title: string; body: string }
  onText?: (text: string) => void
  onFile?: (name: string, text: string) => void
  onClear?: () => void
  onCopy: () => void
  onDownload?: () => void
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  let count = 1
  let index = text.indexOf('\n')
  while (index !== -1) {
    count += 1
    index = text.indexOf('\n', index + 1)
  }
  return text.endsWith('\n') ? count - 1 : count
}

export function EditorPane({
  side,
  name,
  text,
  mode,
  modeLabel,
  error,
  note,
  readOnly = false,
  stale = false,
  wrap = false,
  empty,
  onText,
  onFile,
  onClear,
  onCopy,
  onDownload,
}: EditorPaneProps) {
  const [over, setOver] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const label = LABELS[side]
  const pane = side !== 'before' && side !== 'after'
  const place = `the ${label.toLowerCase()} ${pane ? 'pane' : 'side'}`
  const lineCount = countLines(text)
  const size = useMemo(() => new Blob([text]).size, [text])
  const canOpen = !readOnly && onFile !== undefined

  function loadFile(file: File | undefined) {
    if (!file || !onFile) return
    readTextFile(file).then(
      (content) => {
        setNotice(null)
        onFile(file.name, content)
      },
      (error: unknown) => setNotice(error instanceof Error ? error.message : String(error)),
    )
  }

  const message = notice ?? error
  const emptyCopy = empty ?? { title: 'Drop a file here', body: `or paste ${modeLabel} text` }

  return (
    <section
      className={`editor editor-${side}${over ? ' is-over' : ''}${message ? ' has-error' : ''}${readOnly ? ' is-readonly' : ''}`}
      aria-label={`${label} file`}
      onDragOver={(event) => {
        // Dragged text belongs to the editor; only files replace the pane.
        if (!canOpen || !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setOver(false)
      }}
      onDrop={(event) => {
        if (!canOpen || event.dataTransfer.files.length === 0) return
        event.preventDefault()
        setOver(false)
        loadFile(event.dataTransfer.files[0])
      }}
    >
      <header className="editor-head">
        <div className="editor-title">
          <span className={`side-dot ${side}`} aria-hidden="true" />
          <strong title={name}>{name}</strong>
          <span className="side-label">({label})</span>
        </div>
        <div className="editor-tools">
          <span className="editor-meta">{lineCount.toLocaleString()} {lineCount === 1 ? 'line' : 'lines'} · {formatBytes(size)}</span>
          {canOpen ? (
            <button type="button" className="icon-btn" title="Open a file" aria-label={`Open a file ${pane ? 'in' : 'on'} ${place}`} onClick={() => fileRef.current?.click()}>
              <OpenIcon />
            </button>
          ) : null}
          <button type="button" className="icon-btn" title="Copy this text" aria-label={`Copy the ${label.toLowerCase()} text`} disabled={text.length === 0} data-testid={`copy-${side}`} onClick={onCopy}>
            <CopyIcon />
          </button>
          {onDownload ? (
            <button type="button" className="icon-btn" title={`Download ${name}`} aria-label={`Download ${name}`} disabled={text.length === 0} data-testid={`download-${side}`} onClick={onDownload}>
              <DownloadIcon />
            </button>
          ) : null}
          {onClear ? (
            <button
              type="button"
              className="icon-btn"
              title="Clear"
              aria-label={`Clear ${place}`}
              disabled={text.length === 0}
              onClick={() => {
                setNotice(null)
                onClear()
              }}
            >
              <CloseIcon />
            </button>
          ) : null}
          {canOpen ? (
            <input
              ref={fileRef}
              type="file"
              hidden
              accept={TEXT_ACCEPT}
              onChange={(event) => {
                loadFile(event.target.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          ) : null}
        </div>
      </header>
      <div className={`editor-shell${stale ? ' is-stale' : ''}`}>
        <CodeEditor
          value={text}
          mode={mode}
          label={`${label} ${modeLabel} text`}
          testId={`text-${side}`}
          wrap={wrap}
          readOnly={readOnly}
          maxLength={readOnly ? undefined : MAX_BYTES}
          onChange={(next) => {
            if (notice) setNotice(null)
            onText?.(next)
          }}
          onTooLong={() => setNotice(`That paste is larger than ${formatBytes(MAX_BYTES)}. Open the file instead, or use a smaller part.`)}
        />
      </div>
      {text.length === 0 ? (
        <div className="editor-empty">
          <span className="editor-empty-icon"><FileIcon size={22} /></span>
          <strong>{emptyCopy.title}</strong>
          <span>{emptyCopy.body}</span>
          {canOpen ? <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>Choose a file</button> : null}
        </div>
      ) : null}
      {message ? <p className="editor-error" role="status">{message}</p> : note ? <p className="editor-note" data-testid={`note-${side}`}>{note}</p> : null}
      {over ? <div className="drop-mask"><FileIcon size={24} />Drop to open as {label.toLowerCase()}</div> : null}
    </section>
  )
}
