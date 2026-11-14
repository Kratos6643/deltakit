import { followLink, PATHS, type Page } from '../lib/routes.ts'
import brandMark from '../assets/brand/mark-forest.svg'
import brandMarkDark from '../assets/brand/mark-ocean.svg'
import type { Theme } from '../lib/theme.ts'
import { MoonIcon, SunIcon } from './Icons.tsx'

const NAV: { id: Page; label: string; title: string }[] = [
  { id: 'home', label: 'Home', title: 'Start here' },
  { id: 'compare', label: 'Compare', title: 'Compare two files' },
  { id: 'convert', label: 'Convert', title: 'Turn JSON, YAML, XML, and CSV into each other' },
  { id: 'decode', label: 'Decode', title: 'Read JWTs, Base64, and URL-encoded text' },
  { id: 'lists', label: 'Lists', title: 'Find what two or three lists share and where they differ' },
  { id: 'help', label: 'Help', title: 'How DeltaKit works · ?' },
]

export type TopBarProps = {
  page: Page
  onPage: (page: Page) => void
  theme: Theme
  onTheme: () => void
}

export function TopBar({ page, onPage, theme, onTheme }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href={PATHS.home} aria-label="DeltaKit by Avinash Rapolu, home" onClick={(event) => followLink(event, onPage, 'home')}>
          <img className="brand-mark" src={theme === 'dark' ? brandMarkDark : brandMark} width="40" height="40" alt="" />
          <span className="brand-name">DeltaKit</span>
          <span className="brand-by">by Avinash Rapolu</span>
        </a>
        <nav className="site-nav" aria-label="Pages">
          {NAV.map((item) => (
            <a
              key={item.id}
              href={PATHS[item.id]}
              title={item.title}
              aria-current={page === item.id ? 'page' : undefined}
              data-testid={`tool-${item.id}`}
              onClick={(event) => followLink(event, onPage, item.id)}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="topbar-end">
          <span className="runtime-pill" title="Files, tokens, and text are read in this browser tab and never sent anywhere">
            <span className="status-dot" aria-hidden="true" />
            100% Client-side
          </span>
          <button
            type="button"
            className="icon-btn theme-btn"
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            data-testid="theme"
            onClick={onTheme}
          >
            {theme === 'dark' ? <MoonIcon size={18} /> : <SunIcon size={18} />}
          </button>
        </div>
      </div>
    </header>
  )
}
