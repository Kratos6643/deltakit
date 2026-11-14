import { useRef, type KeyboardEvent } from 'react'

export type SegmentOption<T extends string> = {
  id: T
  label: string
  title?: string
  disabled?: boolean
  badge?: number
}

type SegmentedProps<T extends string> = {
  label: string
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  testId?: string
  small?: boolean
}

export function Segmented<T extends string>({ label, options, value, onChange, testId, small }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const enabled = options.filter((option) => !option.disabled)
    const current = enabled.findIndex((option) => option.id === value)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = enabled[(current + step + enabled.length) % enabled.length]
    if (!next) return
    event.preventDefault()
    onChange(next.id)
    ref.current?.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus()
  }

  return (
    <div ref={ref} className={`segmented${small ? ' is-small' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          data-id={option.id}
          data-testid={testId ? `${testId}-${option.id}` : undefined}
          aria-checked={value === option.id}
          tabIndex={value === option.id ? 0 : -1}
          title={option.title}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {option.badge ? <span className="badge">{option.badge}</span> : null}
        </button>
      ))}
    </div>
  )
}
