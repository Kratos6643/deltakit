import { useEffect, useMemo, useState } from 'react'
import { EditorPane } from '../components/EditorPane.tsx'
import { CopyIcon, DeleteIcon, SwapIcon, WrapIcon } from '../components/Icons.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { SplitBox } from '../components/SplitBox.tsx'
import { copyAndTell, downloadText } from '../lib/clipboard.ts'
import { convert, FORMATS, sniffFormat, type DataFormat } from '../lib/convert.ts'
import { MOD_KEY } from '../lib/keys.ts'
import type { Handoff } from '../lib/routes.ts'
import { errorMessage } from '../lib/values.ts'

type ConvertToolProps = {
  active: boolean
  notify: (text: string) => void
  incoming?: Handoff
}

type Run = { text: string; name: string }

const MIME: Record<DataFormat, string> = {
  json: 'application/json;charset=utf-8',
  yaml: 'application/yaml;charset=utf-8',
  xml: 'application/xml;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
}

const OPTIONS = FORMATS.map((format) => ({ id: format.id, label: format.label }))

function labelOf(format: DataFormat): string {
  return FORMATS.find((item) => item.id === format)?.label ?? format
}

function extOf(format: DataFormat): string {
  return FORMATS.find((item) => item.id === format)?.ext ?? format
}

function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function ConvertTool({ active, notify, incoming }: ConvertToolProps) {
  const [from, setFrom] = useState<DataFormat>('json')
  const [to, setTo] = useState<DataFormat>('yaml')
  const [text, setText] = useState('')
  const [name, setName] = useState('data.json')
  const [run, setRun] = useState<Run | null>(null)
  const [wrap, setWrap] = useState(false)

  // A file from the Home page is converted right away.
  const [taken, setTaken] = useState<number | undefined>(undefined)
  if (incoming && incoming.at !== taken) {
    setTaken(incoming.at)
    const [file] = incoming.files
    const nextFrom = sniffFormat(file.name ?? '', file.text) ?? from
    const nextName = file.name ?? `data.${extOf(nextFrom)}`
    setFrom(nextFrom)
    if (nextFrom === to) setTo(from)
    setText(file.text)
    setName(nextName)
    setRun({ text: file.text, name: nextName })
  }

  // Text edits wait for Convert; a new format choice applies to the text that was last converted.
  const outcome = useMemo(() => {
    if (!run) return null
    try {
      return { ...convert(from, to, run.text), error: undefined }
    } catch (error) {
      return { output: '', notes: [], error: errorMessage(error) }
    }
  }, [run, from, to])

  const empty = text.trim() === ''
  if (empty && run !== null) setRun(null)
  const outdated = !empty && run?.text !== text
  const stale = outdated && outcome !== null && !outcome.error
  const output = outcome?.output ?? ''
  const outputName = `${stem(run?.name ?? name)}.${extOf(to)}`
  const inputError = outcome?.error && run?.text === text ? outcome.error : undefined

  function setFormats(nextFrom: DataFormat, nextTo: DataFormat) {
    if (name === `data.${extOf(from)}`) setName(`data.${extOf(nextFrom)}`)
    setFrom(nextFrom)
    setTo(nextTo)
  }

  function chooseFrom(next: DataFormat) {
    if (next !== from) setFormats(next, next === to ? from : to)
  }

  function chooseTo(next: DataFormat) {
    if (next !== to) setFormats(next === from ? to : from, next)
  }

  function convertNow() {
    if (empty) return
    if (!outdated) {
      notify('The result is already up to date')
      return
    }
    setRun({ text, name })
  }

  function editText(next: string) {
    if (text.trim() === '' && next.trim() !== '') {
      const sniffed = sniffFormat('', next)
      if (sniffed && sniffed !== from) {
        setFormats(sniffed, sniffed === to ? from : to)
        notify(`This looks like ${labelOf(sniffed)}, so From is now ${labelOf(sniffed)}`)
      }
    }
    setText(next)
  }

  function openFile(fileName: string, content: string) {
    const sniffed = sniffFormat(fileName, content)
    if (sniffed && sniffed !== from) setFormats(sniffed, sniffed === to ? from : to)
    setText(content)
    setName(fileName)
  }

  function takeResult() {
    if (!output) return
    setText(output)
    setName(outputName)
    setFrom(to)
    setTo(from)
    setRun({ text: output, name: outputName })
  }

  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      event.preventDefault()
      convertNow()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="page" hidden={!active} data-testid="page-convert">
      <header className="page-head">
        <div className="page-title">
          <p className="eyebrow">Convert</p>
          <h1>Convert between formats</h1>
          <p className="page-lead">Paste or drop JSON, YAML, XML, or CSV on the left, then press Convert.</p>
        </div>
        <div className="page-controls">
          <div className="tool-group">
            <span className="tool-row-label" aria-hidden="true">From</span>
            <Segmented label="Convert from" testId="from" options={OPTIONS} value={from} onChange={chooseFrom} />
          </div>
          <div className="tool-group">
            <span className="tool-row-label" aria-hidden="true">To</span>
            <Segmented label="Convert to" testId="to" options={OPTIONS} value={to} onChange={chooseTo} />
          </div>
        </div>
      </header>

      <div className="inputs">
        <SplitBox
          tall
          label="Conversion"
          toolbar={
            <>
              <div className="tb-group">
                <span className="tb-chip">{labelOf(from)} → {labelOf(to)}</span>
                <span className="tb-chip is-plain">UTF-8</span>
              </div>
              <div className="tb-group">
                <button type="button" className="tb-btn" aria-pressed={wrap} title="Fold long lines to fit the pane" data-testid="wrap" onClick={() => setWrap((on) => !on)}>
                  <WrapIcon size={14} />
                  Soft wrap
                </button>
                <button type="button" className="tb-btn" disabled={!output} title="Move the result to the left, to convert it back" data-testid="use-result" onClick={takeResult}>
                  <SwapIcon size={14} />
                  Use result as input
                </button>
                <button type="button" className="tb-btn" disabled={!output} title={`Copy the ${labelOf(to)} result`} onClick={() => copyAndTell(output, labelOf(to), notify)}>
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
                    setName(`data.${extOf(from)}`)
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
              name={name}
              text={text}
              mode={from}
              modeLabel={labelOf(from)}
              wrap={wrap}
              error={inputError}
              onText={editText}
              onFile={openFile}
              onClear={() => {
                setText('')
                setName(`data.${extOf(from)}`)
              }}
              onCopy={() => copyAndTell(text, 'Input', notify)}
            />
          }
          right={
            <EditorPane
              side="output"
              name={outputName}
              text={output}
              mode={to}
              modeLabel={labelOf(to)}
              wrap={wrap}
              note={outcome && outcome.notes.length > 0 ? outcome.notes.join(' ') : undefined}
              readOnly
              stale={stale}
              empty={{ title: 'The result appears here', body: `Press Convert to turn ${labelOf(from)} into ${labelOf(to)}` }}
              onCopy={() => copyAndTell(output, labelOf(to), notify)}
              onDownload={() => {
                downloadText(outputName, output, MIME[to])
                notify(`Saved ${outputName}`)
              }}
            />
          }
          status={<span>From <b>{labelOf(from)}</b> to <b>{labelOf(to)}</b></span>}
        />
        <div className="bridge">
          <div className="bridge-side is-start" />
          <button
            type="button"
            className={`btn primary compare${outdated ? ' is-due' : ''}`}
            data-testid="convert"
            disabled={empty}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            title={empty ? 'Add text to convert first' : `Convert ${labelOf(from)} to ${labelOf(to)} · ${MOD_KEY} Enter`}
            onClick={convertNow}
          >
            Convert
            <kbd aria-hidden="true">{MOD_KEY} ↵</kbd>
          </button>
          <div className="bridge-side is-end" />
        </div>
      </div>
    </div>
  )
}
