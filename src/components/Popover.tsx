import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from './Icons.tsx'

type PopoverProps = {
  label: string
  icon?: ReactNode
  marked?: boolean
  title?: string
  testId?: string
  children: (close: () => void) => ReactNode
}

export function Popover({ label, icon, marked, title, testId, children }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="popover" ref={ref}>
      <button
        type="button"
        className="tool"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        data-testid={testId}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span>{label}</span>
        {marked ? <span className="mark-dot" aria-label="changed from default" /> : null}
        <ChevronDownIcon size={14} />
      </button>
      {open ? (
        <div className="popover-panel" role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}
