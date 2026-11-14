type SwitchProps = {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  title?: string
  testId?: string
}

export function Switch({ label, description, checked, onChange, disabled, title, testId }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className={`switch${description ? ' has-description' : ''}`}
      aria-checked={checked}
      disabled={disabled}
      title={title}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span className="switch-copy">
        <span className="switch-label">{label}</span>
        {description ? <span className="switch-description">{description}</span> : null}
      </span>
    </button>
  )
}
