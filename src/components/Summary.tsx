import { headlineFor, type Tally, type Verdict } from '../lib/tally.ts'

export function Summary({ verdict, tally, hint }: { verdict: Verdict; tally: Tally; hint?: string }) {
  const tone = hint ? 'empty' : verdict.identical || verdict.percent >= 90 ? 'good' : verdict.percent >= 60 ? 'mid' : 'low'
  const parts = [
    { tone: 'add', count: tally.added, label: 'added' },
    { tone: 'del', count: tally.removed, label: 'removed' },
    { tone: 'mod', count: tally.changed, label: 'changed' },
    { tone: 'move', count: tally.moved, label: 'moved' },
  ].filter((part) => part.count > 0 || part.tone !== 'move')

  return (
    <div className={`summary tone-${tone}`} data-testid="summary" aria-live="polite">
      <svg className="ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="ring-track" cx="18" cy="18" r="15" pathLength="100" />
        {hint ? null : <circle className="ring-value" cx="18" cy="18" r="15" pathLength="100" strokeDasharray={`${verdict.percent} 100`} />}
      </svg>
      {hint ? (
        <div className="summary-copy">
          <p className="summary-line"><strong data-testid="headline">Ready to compare</strong></p>
          <p className="tally-note">{hint}</p>
        </div>
      ) : (
        <div className="summary-copy">
          <p className="summary-line">
            <strong data-testid="headline">{headlineFor(verdict)}</strong>
            <span data-testid="similarity">{verdict.percent}% of the content matches</span>
          </p>
          {verdict.identical ? (
            <p className="tally-note">Nothing was added, removed, or changed</p>
          ) : (
            <ul className="tally" data-testid="change-count" aria-label={`Changed ${tally.unit.toLowerCase()}`}>
              <li className="tally-unit">{tally.unit}</li>
              {parts.map((part) => (
                <li key={part.label} className={`${part.tone}${part.count === 0 ? ' is-zero' : ''}`}>
                  <b>{part.count.toLocaleString()}</b> {part.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
