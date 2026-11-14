import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { VerifiedIcon } from './Icons.tsx'

type SplitBoxProps = {
  label: string
  toolbar: ReactNode
  left: ReactNode
  right: ReactNode
  status?: ReactNode
  tall?: boolean
}

const MIN_PANE = 200
const STEP = 0.05

export function SplitBox({ label, toolbar, left, right, status, tall }: SplitBoxProps) {
  const [ratio, setRatio] = useState(0.5)
  const [dragging, setDragging] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const share = Math.round(ratio * 100)

  // Both panes keep at least MIN_PANE pixels, or share the room evenly when it is tighter than that.
  function limits(): [number, number] {
    const width = splitRef.current?.getBoundingClientRect().width ?? 0
    const min = width > 0 ? Math.min(0.5, MIN_PANE / width) : 0.2
    return [min, 1 - min]
  }

  function place(next: number) {
    const [low, high] = limits()
    setRatio(Math.min(high, Math.max(low, next)))
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const box = splitRef.current?.getBoundingClientRect()
    if (box && box.width > 0) place((event.clientX - box.left) / box.width)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const [low, high] = limits()
    const moves: Record<string, number> = { ArrowLeft: ratio - STEP, ArrowRight: ratio + STEP, Home: low, End: high, Enter: 0.5 }
    if (!(event.key in moves)) return
    event.preventDefault()
    place(moves[event.key])
  }

  return (
    <section className={`splitbox${tall ? ' is-tall' : ''}`} aria-label={label}>
      <div className="splitbox-toolbar">{toolbar}</div>
      <div ref={splitRef} className={`panes${dragging ? ' is-dragging' : ''}`} style={{ '--split': ratio } as CSSProperties}>
        {left}
        <div
          className="pane-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the panes"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={share}
          aria-valuetext={`${share}% and ${100 - share}%`}
          tabIndex={0}
          title="Drag to resize · double-click to split evenly"
          data-testid="split-handle"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            setDragging(true)
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onDoubleClick={() => setRatio(0.5)}
          onKeyDown={onKeyDown}
        >
          <span className="grip" aria-hidden="true" />
        </div>
        {right}
      </div>
      <div className="splitbox-status">
        <span className="status-facts">
          {status}
          <span>Split <b data-testid="split-ratio">{share}% / {100 - share}%</b></span>
        </span>
        <span className="status-good">
          <VerifiedIcon size={15} />
          Stays in your browser
        </span>
      </div>
    </section>
  )
}
