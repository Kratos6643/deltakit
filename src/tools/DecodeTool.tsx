import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorPane } from '../components/EditorPane.tsx'
import { CheckIcon, CopyIcon, DeleteIcon, DownloadIcon, KeyIcon, SwapIcon } from '../components/Icons.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { SplitBox } from '../components/SplitBox.tsx'
import { copyAndTell, downloadBytes, downloadText } from '../lib/clipboard.ts'
import {
  decodeBase64,
  decodeJwt,
  decodeUrl,
  encodeBase64,
  encodeUrl,
  KINDS,
  sniffEncoding,
  type DecodeKind,
  type Decoded,
} from '../lib/decode.ts'
import { MOD_KEY } from '../lib/keys.ts'
import type { Handoff } from '../lib/routes.ts'
import { errorMessage } from '../lib/values.ts'

type DecodeToolProps = {
  active: boolean
  notify: (text: string) => void
  incoming?: Handoff
}

type Direction = 'decode' | 'encode'
type Run = { text: string; direction: Direction; at: number }

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
}

const INPUT_COPY: Record<DecodeKind, { name: string; title: string; body: string; ready: string }> = {
  jwt: {
    name: 'Token',
    title: 'Paste a token',
    body: 'A JWT starts with eyJ. “Bearer” in front is fine.',
    ready: 'Press Decode to read the header, the claims, and when the token expires.',
  },
  base64: {
    name: 'Base64 text',
    title: 'Paste Base64',
    body: 'Or any text to encode as Base64',
    ready: 'Press Decode to read it, or Encode to turn the text into Base64.',
  },
  url: {
    name: 'Link or text',
    title: 'Paste a link or %-encoded text',
    body: 'Or any text to encode for a URL',
    ready: 'Press Decode to read it, or Encode to escape it for use in a link.',
  },
}

const OPTIONS = KINDS.map((kind) => ({ id: kind.id, label: kind.label, title: kind.title }))

function labelOf(kind: DecodeKind): string {
  return KINDS.find((item) => item.id === kind)?.label ?? kind
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${count === 1 ? word : `${word}s`}`
}

function perform(kind: DecodeKind, run: Run): Decoded {
  if (run.direction === 'encode' && kind !== 'jwt') {
    const output = kind === 'base64' ? encodeBase64(run.text) : encodeUrl(run.text)
    return {
      output,
      language: 'text',
      notes: kind === 'url' ? ['Every character with a special meaning in links is escaped, so the result fits inside a query value or a path segment.'] : [],
      title: kind === 'base64' ? 'Encoded as Base64' : 'Encoded for a URL',
      facts: [
        { label: 'Input', value: plural(new TextEncoder().encode(run.text).length, 'byte') },
        { label: 'Result', value: plural(output.length, 'character') },
      ],
    }
  }
  if (kind === 'jwt') return decodeJwt(run.text, run.at)
  if (kind === 'base64') return decodeBase64(run.text)
  return decodeUrl(run.text)
}

function BlobImage({ bytes, mime, alt }: { bytes: Uint8Array; mime: string; alt: string }) {
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }))
    if (ref.current) ref.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [bytes, mime])
  return <img ref={ref} className="preview" alt={alt} data-testid="preview" />
}

function toneOf(decoded: Decoded): 'good' | 'bad' | undefined {
  if (decoded.facts.some((fact) => fact.tone === 'bad')) return 'bad'
  if (decoded.facts.some((fact) => fact.tone === 'good')) return 'good'
  return undefined
}

export function DecodeTool({ active, notify, incoming }: DecodeToolProps) {
  const [kind, setKind] = useState<DecodeKind>('jwt')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [run, setRun] = useState<Run | null>(null)

  // Text from the Home page is decoded right away.
  const [taken, setTaken] = useState<number | undefined>(undefined)
  if (incoming && incoming.at !== taken) {
    setTaken(incoming.at)
    const [file] = incoming.files
    const sniffed = sniffEncoding(file.text)
    if (sniffed) setKind(sniffed)
    setText(file.text)
    setFileName(file.name ?? null)
    setRun({ text: file.text, direction: 'decode', at: incoming.at })
  }

  // Text edits wait for Decode or Encode; a new type choice applies to the text that was last read.
  const outcome = useMemo(() => {
    if (!run) return null
    try {
      return { decoded: perform(kind, run), error: undefined }
    } catch (error) {
      return { decoded: null, error: errorMessage(error) }
    }
  }, [kind, run])

  const empty = text.trim() === ''
  if (empty && run !== null) setRun(null)
  const outdated = !empty && run?.text !== text
  const decoded = outcome?.decoded ?? null
  const binary = decoded?.binary
  const output = decoded?.output ?? ''
  const direction: Direction = run?.direction === 'encode' && kind !== 'jwt' ? 'encode' : 'decode'
  const inputError = outcome?.error && run?.text === text ? outcome.error : undefined
  const outputName = binary
    ? `decoded.${EXTENSIONS[binary.mime ?? ''] ?? 'bin'}`
    : kind === 'jwt' && direction === 'decode'
      ? 'token.json'
      : `${direction === 'encode' ? 'encoded' : 'decoded'}.${decoded?.language === 'json' ? 'json' : 'txt'}`
  const copy = INPUT_COPY[kind]
  const tone = decoded ? toneOf(decoded) : undefined
  const imageMime = binary?.mime?.startsWith('image/') ? binary.mime : undefined

  function start(next: Direction) {
    if (empty) return
    setRun({ text, direction: next, at: Date.now() })
  }

  function editText(next: string) {
    if (text.trim() === '' && next.trim() !== '') {
      const sniffed = sniffEncoding(next)
      if (sniffed && sniffed !== kind) {
        setKind(sniffed)
        notify(`This looks like ${labelOf(sniffed)}, so the type is now ${labelOf(sniffed)}`)
      }
    }
    setText(next)
  }

  function openFile(name: string, content: string) {
    const sniffed = sniffEncoding(content)
    if (sniffed && sniffed !== kind) setKind(sniffed)
    setText(content)
    setFileName(name)
  }

  function takeResult() {
    if (!output || binary) return
    setText(output)
    setFileName(null)
    setRun(null)
  }

  function download() {
    if (binary) downloadBytes(outputName, binary.bytes, binary.mime)
    else downloadText(outputName, output, decoded?.language === 'json' ? 'application/json;charset=utf-8' : undefined)
    notify(`Saved ${outputName}`)
  }

  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      start('decode')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="page" hidden={!active} data-testid="page-decode">
      <header className="page-head">
        <div className="page-title">
          <p className="eyebrow">Decode</p>
          <h1>Decode tokens and text</h1>
          <p className="page-lead">Paste a JWT, Base64, or %-encoded link on the left, then press Decode. Base64 and URL can also be encoded.</p>
        </div>
        <div className="page-controls">
          <Segmented label="What to read" testId="kind" options={OPTIONS} value={kind} onChange={setKind} />
        </div>
      </header>

      <div className="inputs">
        <SplitBox
          tall
          label="Decoding"
          toolbar={
            <>
              <div className="tb-group">
                <span className="tb-chip">{labelOf(kind)}</span>
                <span className="tb-chip is-plain">UTF-8</span>
              </div>
              <div className="tb-group">
                <button type="button" className="tb-btn" disabled={!output || binary !== undefined} title="Move the result to the left, to read it again" data-testid="use-result" onClick={takeResult}>
                  <SwapIcon size={14} />
                  Use result as input
                </button>
                <button type="button" className="tb-btn" disabled={!output || binary !== undefined} title="Copy the result" onClick={() => copyAndTell(output, 'Result', notify)}>
                  <CopyIcon size={14} />
                  Copy result
                </button>
                <button
                  type="button"
                  className="tb-btn is-danger"
                  disabled={text.length === 0}
                  title="Clear the input"
                  onClick={() => {
                    setText('')
                    setFileName(null)
                  }}
                >
                  <DeleteIcon size={14} />
                  Clear
                </button>
              </div>
            </>
          }
          left={
            <EditorPane
              side="input"
              name={fileName ?? copy.name}
              text={text}
              mode="text"
              modeLabel={labelOf(kind)}
              error={inputError}
              wrap
              empty={{ title: copy.title, body: copy.body }}
              onText={editText}
              onFile={openFile}
              onClear={() => {
                setText('')
                setFileName(null)
              }}
              onCopy={() => copyAndTell(text, 'Input', notify)}
            />
          }
          right={
            <EditorPane
              side="output"
              name={outputName}
              text={output}
              mode={decoded?.language === 'json' ? 'json' : 'text'}
              modeLabel={labelOf(kind)}
              readOnly
              wrap={decoded?.language !== 'json' && binary === undefined}
              stale={outdated && decoded !== null}
              empty={{ title: 'The result appears here', body: kind === 'jwt' ? 'Press Decode to read the token' : 'Press Decode or Encode' }}
              onCopy={() => copyAndTell(output, 'Result', notify)}
              onDownload={download}
            />
          }
          status={<span>Type <b>{labelOf(kind)}</b></span>}
        />
        <div className="bridge">
          <div className="bridge-side is-start" />
          <div className="bridge-actions">
            <button
              type="button"
              className={`btn primary compare${outdated && direction === 'decode' ? ' is-due' : ''}`}
              data-testid="decode"
              disabled={empty}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              title={empty ? 'Add text to decode first' : `Decode ${labelOf(kind)} · ${MOD_KEY} Enter`}
              onClick={() => start('decode')}
            >
              Decode
              <kbd aria-hidden="true">{MOD_KEY} ↵</kbd>
            </button>
            {kind !== 'jwt' ? (
              <button
                type="button"
                className={`btn wide${outdated && direction === 'encode' ? ' is-due' : ''}`}
                data-testid="encode"
                disabled={empty}
                title={kind === 'base64' ? 'Encode the text as Base64' : 'Escape the text for use in a URL'}
                onClick={() => start('encode')}
              >
                Encode
              </button>
            ) : null}
          </div>
          <div className="bridge-side is-end" />
        </div>
      </div>

      <section className={`details${outdated && decoded ? ' is-stale' : ''}`} aria-label="Details" data-testid="details">
        {decoded ? (
          <>
            <header className="details-head">
              <span className={`details-badge${tone ? ` is-${tone}` : ''}`}>{tone === 'good' ? <CheckIcon size={18} /> : <KeyIcon size={18} />}</span>
              <div className="details-title">
                <strong data-testid="details-title">{decoded.title}</strong>
                <span>{labelOf(kind)} · {direction === 'encode' ? 'encoded' : 'decoded'} in your browser</span>
              </div>
              {binary ? (
                <button type="button" className="btn" onClick={download} data-testid="download-binary">
                  <DownloadIcon size={15} />
                  Download {binary.label}
                </button>
              ) : null}
            </header>
            {decoded.facts.length > 0 ? (
              <dl className="facts">
                {decoded.facts.map((fact) => (
                  <div key={fact.label} className={`fact${fact.tone ? ` is-${fact.tone}` : ''}`}>
                    <dt>{fact.label}</dt>
                    <dd>
                      <span>{fact.value}</span>
                      {fact.detail ? <small>{fact.detail}</small> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {decoded.params ? (
              <div className="table-wrap">
                <table className="data params" data-testid="params">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decoded.params.map(([key, value], index) => (
                      <tr key={`${index}-${key}`}>
                        <td>{key}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {binary && imageMime ? (
              <div className="preview-wrap">
                <BlobImage bytes={binary.bytes} mime={imageMime} alt={`Decoded ${binary.label}`} />
              </div>
            ) : null}
            {decoded.notes.length > 0 ? (
              <ul className="details-notes">
                {decoded.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            ) : null}
          </>
        ) : outcome?.error ? (
          <div className="state" data-testid="details-error">
            <strong>This is not valid {labelOf(kind)}</strong>
            <p>{outcome.error}</p>
            <div className="state-actions">
              {KINDS.filter((item) => item.id !== kind).map((item) => (
                <button key={item.id} type="button" className="btn small" onClick={() => setKind(item.id)}>Read as {item.label}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="state welcome" data-testid="details-ready">
            <span className="state-icon"><KeyIcon size={22} /></span>
            <strong>{empty ? 'Decode a token or text' : 'Ready to decode'}</strong>
            <p>{empty ? 'Paste a JWT, Base64, or %-encoded text above, then press Decode. DeltaKit picks the type for you when it can tell.' : copy.ready}</p>
          </div>
        )}
      </section>
    </div>
  )
}
