import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

type DraftInputProps = {
  label: string
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  hint?: ReactNode
  validate?: (value: string) => string | null
  suggestions?: string[]
  testId?: string
  children?: ReactNode
}

const IDLE_MS = 500

// A typed value applies after a short pause, on Enter, or when the field closes, so a
// half-typed name never starts a comparison.
export function DraftInput({ label, value, onCommit, placeholder, hint, validate, suggestions, testId, children }: DraftInputProps) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [source, setSource] = useState(value)
  if (source !== value) {
    setSource(value)
    setDraft(value)
  }
  const error = validate ? validate(draft) : null
  const latest = useRef({ draft, value, error, onCommit })

  useEffect(() => {
    latest.current = { draft, value, error, onCommit }
  })

  useEffect(() => {
    if (draft === value || error) return
    const timer = window.setTimeout(() => latest.current.onCommit(draft), IDLE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, value, error])

  useEffect(() => () => {
    const current = latest.current
    if (current.draft !== current.value && !current.error) current.onCommit(current.draft)
  }, [])

  function commit() {
    if (draft !== value && !error) onCommit(draft)
  }

  const note = error ?? hint
  const listId = suggestions && suggestions.length > 0 ? `${id}-list` : undefined
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children}
      <input
        id={id}
        className="field-input"
        value={draft}
        placeholder={placeholder}
        list={listId}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? `${id}-note` : undefined}
        data-testid={testId}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit()
        }}
      />
      {suggestions && listId ? (
        <datalist id={listId}>
          {suggestions.map((item) => <option key={item} value={item} />)}
        </datalist>
      ) : null}
      {note ? <span id={`${id}-note`} className={error ? 'field-error' : 'field-hint'}>{note}</span> : null}
    </div>
  )
}
