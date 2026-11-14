import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Footer } from './components/Footer.tsx'
import { TopBar } from './components/TopBar.tsx'
import { isTyping } from './lib/keys.ts'
import { pageFromLocation, PATHS, type Handoff, type Page, type Tool } from './lib/routes.ts'
import { applyTheme, saveTheme, type Theme } from './lib/theme.ts'
import { HelpPage } from './pages/HelpPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { preloadTool, TOOL_PAGES } from './tools/pages.ts'

const CompareTool = TOOL_PAGES.compare.Page
const ConvertTool = TOOL_PAGES.convert.Page
const DecodeTool = TOOL_PAGES.decode.Page
const ListsTool = TOOL_PAGES.lists.Page

const TITLES: Record<Page, string> = {
  home: 'DeltaKit — compare, convert, and decode data in your browser',
  compare: 'Compare text, JSON, XML, YAML, and CSV — DeltaKit',
  convert: 'Convert JSON, YAML, XML, and CSV — DeltaKit',
  decode: 'Decode JWT, Base64, and URL text — DeltaKit',
  lists: 'Compare lists: union, intersection, and difference — DeltaKit',
  help: 'Help — DeltaKit',
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromLocation)
  const [opened, setOpened] = useState<Set<Page>>(() => new Set([pageFromLocation()]))
  if (!opened.has(page)) setOpened(new Set(opened).add(page))
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const [handoffs, setHandoffs] = useState<Partial<Record<Tool, Handoff>>>({})
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const pageRef = useRef(page)
  const scrolls = useRef<Partial<Record<Page, number>>>({})

  const notify = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), text })
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }, [])

  // Each page keeps its own scroll position, so switching back lands where you left off.
  useLayoutEffect(() => {
    pageRef.current = page
    window.scrollTo(0, scrolls.current[page] ?? 0)
  }, [page])

  // The other tools load once the first page, its fonts, and its tool are in, so they never compete with them.
  useEffect(() => {
    const loaded = new Promise((resolve) => {
      if (document.readyState === 'complete') resolve(null)
      else window.addEventListener('load', resolve, { once: true })
    })
    Promise.all([loaded, document.fonts.ready, preloadTool(pageFromLocation())]).then(() => {
      preloadTool('compare')
      preloadTool('convert')
      preloadTool('decode')
      preloadTool('lists')
    })
  }, [])

  useEffect(() => {
    window.history.scrollRestoration = 'manual'
    function sync() {
      scrolls.current[pageRef.current] = window.scrollY
      startTransition(() => setPage(pageFromLocation()))
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  useLayoutEffect(() => {
    document.title = TITLES[page]
  }, [page])

  // A file dropped outside a drop zone would make the browser leave the page to show it.
  useEffect(() => {
    function hold(event: DragEvent) {
      if (event.defaultPrevented || !event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', hold)
    window.addEventListener('drop', hold)
    return () => {
      window.removeEventListener('dragover', hold)
      window.removeEventListener('drop', hold)
    }
  }, [])

  const go = useCallback((next: Page) => {
    if (next === pageRef.current) return
    scrolls.current[pageRef.current] = window.scrollY
    window.history.pushState(null, '', PATHS[next])
    startTransition(() => setPage(next))
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      event.preventDefault()
      go('help')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  const open = useCallback((tool: Tool, files: Handoff['files']) => {
    setHandoffs((current) => ({ ...current, [tool]: { at: Date.now(), files } }))
    go(tool)
  }, [go])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
    saveTheme(next)
  }

  return (
    <div className="app">
      <TopBar page={page} onPage={go} theme={theme} onTheme={toggleTheme} />
      <main className="main">
        {opened.has('home') ? <HomePage active={page === 'home'} onPage={go} onOpen={open} notify={notify} /> : null}
        {opened.has('compare') ? <CompareTool active={page === 'compare'} notify={notify} incoming={handoffs.compare} /> : null}
        {opened.has('convert') ? <ConvertTool active={page === 'convert'} notify={notify} incoming={handoffs.convert} /> : null}
        {opened.has('decode') ? <DecodeTool active={page === 'decode'} notify={notify} incoming={handoffs.decode} /> : null}
        {opened.has('lists') ? <ListsTool active={page === 'lists'} notify={notify} /> : null}
        {opened.has('help') ? <HelpPage active={page === 'help'} onPage={go} /> : null}
      </main>
      <Footer onPage={go} />
      <div className="toast-region" aria-live="polite">
        {toast ? <div key={toast.id} className="toast">{toast.text}</div> : null}
      </div>
    </div>
  )
}
