import signature from '../assets/brand/mark-forest.svg'
import signatureDark from '../assets/brand/mark-ocean.svg'
import { followLink, PATHS, type Page } from '../lib/routes.ts'

const LINKS: { id: Page; label: string }[] = [
  { id: 'compare', label: 'Compare' },
  { id: 'convert', label: 'Convert' },
  { id: 'decode', label: 'Decode' },
  { id: 'lists', label: 'Lists' },
  { id: 'help', label: 'Help' },
]

export function Footer({ onPage }: { onPage: (page: Page) => void }) {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-name">DeltaKit</span>
          <span className="footer-dash" aria-hidden="true" />
          <a className="footer-logo" href="https://avinashrapolu.com/" target="_blank" rel="noopener noreferrer" aria-label="Visit Avinash Rapolu’s website" title="avinashrapolu.com">
            <img className="logo-light" src={signature} width="36" height="36" alt="" />
            <img className="logo-dark" src={signatureDark} width="36" height="36" alt="" />
            <span className="footer-author"><small>Made by</small><span>Avinash Rapolu</span></span>
          </a>
        </div>
        <nav className="footer-links" aria-label="Tools">
          {LINKS.map((link) => (
            <a key={link.id} href={PATHS[link.id]} onClick={(event) => followLink(event, onPage, link.id)}>{link.label}</a>
          ))}
          <span className="footer-note">No analytics. Your files stay on this device.</span>
        </nav>
      </div>
    </footer>
  )
}
